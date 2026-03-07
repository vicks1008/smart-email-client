import { getEnv, processPendingSyncJobs, scheduleDueSyncs, syncDueThunderbirdSources } from "@smart-email/core";

const env = getEnv();
const pollIntervalMs = Math.max(15_000, env.MAIL_SYNC_INTERVAL_SECONDS * 1000);

async function runCycle() {
  await scheduleDueSyncs();
  await processPendingSyncJobs();
  await syncDueThunderbirdSources();
}

async function main() {
  console.log(`[mail-worker] starting with ${pollIntervalMs}ms polling interval`);

  await runCycle();

  setInterval(() => {
    runCycle().catch((error) => {
      console.error("[mail-worker] sync cycle failed", error);
    });
  }, pollIntervalMs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
