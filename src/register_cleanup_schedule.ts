import { z } from "zod";
import { infrai } from "./infrai_client.js";

const deleteIndex = process.argv.indexOf("--delete");
if (deleteIndex !== -1) {
  const jobId = z.string().min(1).parse(process.argv[deleteIndex + 1]);
  await infrai.cron.delete(jobId);
  console.log(JSON.stringify({ deletedJobId: jobId }));
} else {
  const task = z.string().url().parse(process.env.PROPERTY_SWEEP_URL);
  const result = await infrai.cron.create("15 2 * * *", task);

  console.log(JSON.stringify({ jobId: result.job_id, cronExpr: "15 2 * * *", task }, null, 2));
}
