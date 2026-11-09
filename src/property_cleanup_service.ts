import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, infrai } from "./infrai_client.js";
import { selectStaleRecords, sweepRequestSchema } from "./property_retention_policy.js";

const port = Number(process.env.PORT ?? "3000");
const bucket = process.env.PROPERTY_RECORDS_BUCKET ?? "property-record-archive";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1_000_000) throw new RangeError("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/property-records/sweep") {
    sendJson(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const input = sweepRequestSchema.parse(await readJson(request));
    const decisions = selectStaleRecords(input);
    const objectKeys = [...new Set(decisions.map((decision) => decision.objectKey))].sort();

    if (objectKeys.length > 0) {
      await infrai.storage.object.delete_batch(bucket, objectKeys, `property-sweep:${input.sweepId}`);
    }

    sendJson(response, 200, {
      sweepId: input.sweepId,
      examined: input.records.length,
      deletedCount: objectKeys.length,
      deletedObjectKeys: objectKeys,
      decisions,
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError || error instanceof RangeError) {
      sendJson(response, 400, { error: "invalid_sweep_request" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      sendJson(response, status, { error: error.code });
      return;
    }
    sendJson(response, 500, { error: "sweep_failed" });
  }
});

if (process.argv.includes("--delete-bucket")) {
  await infrai.storage.bucket.delete(bucket);
  console.log(JSON.stringify({ deletedBucket: bucket }));
} else {
  await infrai.storage.bucket.create(bucket);
  server.listen(port, () => {
    console.log(`Property cleanup listening on http://localhost:${port}`);
  });
}
