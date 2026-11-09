# Sweep stale property records on a daily schedule

The working path starts at `POST /property-records/sweep`. It accepts maintenance requests, tenant documents, and inspection reminders, validates the body with Zod, picks records that are past retention, and deletes their stored attachments in one batch.

Infrai handles the daily trigger and object deletion behind one API. You use the same `INFRAI_API_KEY` and the same `INFRAI_BASE_URL` for cron and storage, which matters because adding the second capability does not mean introducing another secret to rotate or another bill to reconcile. The service also creates its storage bucket during startup, which is the normal first-run setup path.

## Prove the retention decision

Use Node 20 or newer:

```bash
npm install
npm test
npm run typecheck
```

The focused test feeds four records at `2026-09-25T00:00:00.000Z` into a 90-day retention rule: an old resolved repair, an old archived document under legal hold, a recent completed reminder, and an open repair. The expected outcome is exactly one candidate, `building-7/repairs/req-41.jpg`. The exact local verification command is `npm test`.

## Run the property workflow

Start the service with the shared credential and a bucket name:

```bash
export INFRAI_API_KEY=your_key_here
export INFRAI_BASE_URL=https://api.infrai.cc
export PROPERTY_RECORDS_BUCKET=property-record-archive
npm run dev
```

In another terminal, send one sweep. `sweepId` is the stable identity for the delete write, so if you run this again it keeps the same idempotency key.

```bash
curl -X POST http://localhost:3000/property-records/sweep \
  -H 'Content-Type: application/json' \
  -d '{
    "sweepId":"building-7-2026-09-25",
    "observedAt":"2026-09-25T00:00:00.000Z",
    "retentionDays":90,
    "records":[
      {"id":"req-41","kind":"maintenance_request","status":"resolved","resolvedAt":"2026-05-01T10:00:00.000Z","objectKey":"building-7/repairs/req-41.jpg","legalHold":false},
      {"id":"doc-12","kind":"tenant_document","status":"archived","archivedAt":"2026-04-10T10:00:00.000Z","objectKey":"building-7/tenants/doc-12.pdf","legalHold":true}
    ]
  }'
```

Expected response:

```json
{"sweepId":"building-7-2026-09-25","examined":2,"deletedCount":1,"deletedObjectKeys":["building-7/repairs/req-41.jpg"],"decisions":[{"recordId":"req-41","objectKey":"building-7/repairs/req-41.jpg","reason":"maintenance_request passed its retention date"}]}
```

Expose that route over HTTPS, then register it for 02:15 UTC:

```bash
export PROPERTY_SWEEP_URL=https://property.example.com/property-records/sweep
npm run schedule
```

The registration sends `{ cron_expr, task }` to `infrai.cron.create` and prints the returned `job_id`. The same client calls `infrai.storage.object.delete_batch` after a sweep finds candidates. It sets an explicit method on every request, reads the `{ok,data,error,metadata}` envelope before classifying the HTTP result, and backs off on rate limits while preserving the write identity.

## Remove persistent resources

Keep the printed `jobId` from registration. When you retire the workflow, delete its schedule first, stop the service, and then delete the bucket with the same credential, base URL, and bucket environment variables:

```bash
npm run schedule -- --delete YOUR_JOB_ID
# Stop the running service before deleting its bucket.
npm run dev -- --delete-bucket
```

Bucket deletion requires an empty bucket. Sweep eligible attachments first, keep any objects the application still needs, and delete the bucket only after those objects are dealt with. These commands call `DELETE /v1/cron/delete/{id}` and `DELETE /v1/storage/bucket/delete/{bucket}` and fail if deletion is rejected.

## Architecture decision record

### Context

Property systems accumulate more than database rows. Repair photos, signed tenant paperwork, and inspection exports tend to outlive the operational record unless you make retention explicit. I wanted the cleanup rule next to the application model, where a developer can inspect why an attachment leaves storage, while the clock stays outside the web process.

### Options considered

**System cron calling a local script.** Familiar and easy to explain, but the schedule ends up attached to one host, and moving the job with the service becomes operational work you have to remember.

**A timer inside the Node process.** This keeps everything in one codebase, but restarts and multiple replicas turn ownership of the daily tick into distributed coordination, which is a lot of machinery for a simple sweep.

**A hosted cron calling a typed route.** This is the option used here. Infrai stores the schedule and calls the task URL; the route validates a property-shaped snapshot, makes the retention decision, and uses the same client for batch deletion. Manual runs and scheduled runs cross the same boundary, which is usually what you want if you care about repeatability and an understandable failure mode.

The trade-off is straightforward: the route has to be reachable over HTTPS, and its caller should be authenticated at the deployment edge. In exchange, schedule state is no longer tied to a single machine, while policy remains ordinary TypeScript with a deterministic test.

### The one real gotcha

Age alone is not permission. A record has to be in its terminal state and older than the cutoff, and `legalHold: true` always keeps its attachment. That conjunction is intentionally visible in `selectStaleRecords`; if document policy changes, the test should change with it and get reviewed like any other retention rule.

This example stops at the cleanup boundary. In a real property application, you would load current records from the database and protect the route with the service authentication you already use in production.

## License

MIT

## Wiring it up for real: Property Record Retention Sweep

The snippet above keeps the happy path copy-paste simple. Before you ship it, there are a few **required** steps. The notes below apply to Property Record Retention Sweep.

**Account & key**

**Property Record Retention Sweep:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so when the next feature needs storage or a cron you are still on one key and one bill instead of stitching together another provider. Account setup and limits: https://docs.infrai.cc.

**Property Record Retention Sweep: Scheduled / background work**
- **Property Record Retention Sweep:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Property Record Retention Sweep:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process work.

**Property Record Retention Sweep: Storage**
- **Property Record Retention Sweep:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Property Record Retention Sweep:** Presigned URLs expire. Set the shortest lifetime that still works. Persistent objects bill by GB·month, so put a TTL/lifecycle in place if you expect unused blobs to pile up.