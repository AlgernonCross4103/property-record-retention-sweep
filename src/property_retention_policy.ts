import { z } from "zod";

const sharedFields = {
  id: z.string().min(1),
  objectKey: z.string().min(1),
  legalHold: z.boolean().default(false),
};

const maintenanceRequestSchema = z.object({
  ...sharedFields,
  kind: z.literal("maintenance_request"),
  status: z.enum(["open", "resolved"]),
  resolvedAt: z.string().datetime().optional(),
});

const tenantDocumentSchema = z.object({
  ...sharedFields,
  kind: z.literal("tenant_document"),
  status: z.enum(["active", "archived"]),
  archivedAt: z.string().datetime().optional(),
});

const inspectionReminderSchema = z.object({
  ...sharedFields,
  kind: z.literal("inspection_reminder"),
  status: z.enum(["pending", "completed"]),
  completedAt: z.string().datetime().optional(),
});

export const propertyRecordSchema = z.discriminatedUnion("kind", [
  maintenanceRequestSchema,
  tenantDocumentSchema,
  inspectionReminderSchema,
]);

export const sweepRequestSchema = z.object({
  sweepId: z.string().min(1).max(100),
  observedAt: z.string().datetime(),
  retentionDays: z.number().int().min(1).max(3650),
  records: z.array(propertyRecordSchema).max(1000),
});

export type PropertyRecord = z.infer<typeof propertyRecordSchema>;
export type SweepRequest = z.infer<typeof sweepRequestSchema>;

export type CleanupDecision = {
  recordId: string;
  objectKey: string;
  reason: string;
};

function terminalDate(record: PropertyRecord): string | undefined {
  if (record.kind === "maintenance_request" && record.status === "resolved") return record.resolvedAt;
  if (record.kind === "tenant_document" && record.status === "archived") return record.archivedAt;
  if (record.kind === "inspection_reminder" && record.status === "completed") return record.completedAt;
  return undefined;
}

export function selectStaleRecords(input: SweepRequest): CleanupDecision[] {
  const cutoff = Date.parse(input.observedAt) - input.retentionDays * 86_400_000;

  return input.records.flatMap((record) => {
    const completedAt = terminalDate(record);
    if (record.legalHold || !completedAt || Date.parse(completedAt) > cutoff) return [];
    return [{
      recordId: record.id,
      objectKey: record.objectKey,
      reason: `${record.kind} passed its retention date`,
    }];
  });
}
