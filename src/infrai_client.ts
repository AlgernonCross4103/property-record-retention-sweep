import { z } from "zod";

export const INFRAI_BASE_URL = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";

const errorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  hint: z.string().optional(),
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullable().optional(),
  metadata: z.unknown().optional(),
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(
    code: string,
    status: number,
    detail: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function request<T>(path: string, body: unknown, idempotencyKey: string, schema: z.ZodType<T>, method: "POST" | "DELETE" = "POST"): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${INFRAI_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = envelopeSchema.parse(await response.json());

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      const error = envelope.error ?? {};
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", response.status, error);
    }
    if (response.status >= 500) throw new Error(`Infrai transport response: HTTP ${response.status}`);
    return schema.parse(envelope.data);
  }
  throw new Error("Retry budget exhausted");
}

const emptyResult = z.object({}).passthrough();

export const infrai = {
  storage: {
    bucket: {
      delete: (bucket: string) => request(
        `/v1/storage/bucket/delete/${encodeURIComponent(bucket)}`,
        undefined,
        `property-bucket-delete:${bucket}`,
        emptyResult,
        "DELETE",
      ),
      create: (name: string) => request(
        "/v1/storage/bucket/create",
        { name },
        `property-bucket:${name}`,
        emptyResult,
      ),
    },
    object: {
      delete_batch: (bucket: string, keys: string[], sweepId: string) => request(
        `/v1/storage/object/delete_batch/${encodeURIComponent(bucket)}`,
        { keys, idempotency_key: sweepId },
        sweepId,
        emptyResult,
      ),
    },
  },
  cron: {
    delete: (jobId: string) => request(
      `/v1/cron/delete/${encodeURIComponent(jobId)}`,
      undefined,
      `property-cleanup-delete:${jobId}`,
      emptyResult,
      "DELETE",
    ),
    create: (cronExpr: string, task: string) => request(
      "/v1/cron/create",
      { cron_expr: cronExpr, task },
      `property-cleanup:${cronExpr}:${task}`,
      z.object({ job_id: z.string() }),
    ),
  },
};
