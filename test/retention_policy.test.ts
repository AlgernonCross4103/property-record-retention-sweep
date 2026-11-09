import assert from "node:assert/strict";
import test from "node:test";
import { selectStaleRecords, sweepRequestSchema } from "../src/property_retention_policy.js";

test("selects terminal records past retention and keeps active, recent, or held records", () => {
  const input = sweepRequestSchema.parse({
    sweepId: "building-7-2026-09-25",
    observedAt: "2026-09-25T00:00:00.000Z",
    retentionDays: 90,
    records: [
      { id: "req-41", kind: "maintenance_request", status: "resolved", resolvedAt: "2026-05-01T10:00:00.000Z", objectKey: "building-7/repairs/req-41.jpg", legalHold: false },
      { id: "doc-12", kind: "tenant_document", status: "archived", archivedAt: "2026-04-10T10:00:00.000Z", objectKey: "building-7/tenants/doc-12.pdf", legalHold: true },
      { id: "rem-8", kind: "inspection_reminder", status: "completed", completedAt: "2026-09-01T10:00:00.000Z", objectKey: "building-7/inspections/rem-8.json", legalHold: false },
      { id: "req-42", kind: "maintenance_request", status: "open", objectKey: "building-7/repairs/req-42.jpg", legalHold: false },
    ],
  });

  assert.deepEqual(selectStaleRecords(input), [{
    recordId: "req-41",
    objectKey: "building-7/repairs/req-41.jpg",
    reason: "maintenance_request passed its retention date",
  }]);
});
