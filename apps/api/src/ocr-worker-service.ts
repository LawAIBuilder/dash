/**
 * Long-running OCR worker for shared deployment environments.
 * Runs beside the API, polling the same SQLite DB on an interval.
 */
import { openDatabase } from "./db.js";
import { readPositiveIntegerEnv } from "./env.js";
import { requeueProcessingOcrAttempts, runOcrWorkerLoop } from "./ocr-worker.js";
import { writeWorkerHeartbeat } from "./worker-health.js";

const db = openDatabase();

const workerName = "ocr";
const maxPasses = readPositiveIntegerEnv("OCR_WORKER_MAX_PASSES", 25, { min: 1 });
const intervalMs = readPositiveIntegerEnv("OCR_WORKER_INTERVAL_MS", 15_000, { min: 1 });

let stopping = false;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const recovered = requeueProcessingOcrAttempts(db);
  writeWorkerHeartbeat(db, {
    workerName,
    status: "starting",
    processedCount: recovered,
    metadata: { recovered_processing_attempts: recovered, interval_ms: intervalMs, max_passes: maxPasses }
  });

  // eslint-disable-next-line no-console
  console.log(`OCR worker service started (maxPasses=${maxPasses}, intervalMs=${intervalMs}).`);

  while (!stopping) {
    try {
      writeWorkerHeartbeat(db, {
        workerName,
        status: "processing"
      });
      const { processed } = await runOcrWorkerLoop(db, maxPasses);
      writeWorkerHeartbeat(db, {
        workerName,
        status: "idle",
        processedCount: processed
      });
      if (processed > 0) {
        // eslint-disable-next-line no-console
        console.log(`OCR worker pass processed ${processed} attempt(s).`);
      }
    } catch (error) {
      writeWorkerHeartbeat(db, {
        workerName,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown OCR worker error"
      });
      // eslint-disable-next-line no-console
      console.error("OCR worker loop error", error);
    }

    if (!stopping) {
      await sleep(intervalMs);
    }
  }

  const recoveredOnStop = requeueProcessingOcrAttempts(db);
  writeWorkerHeartbeat(db, {
    workerName,
    status: "stopped",
    processedCount: recoveredOnStop
  });
  db.close();
}

function stop(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`Stopping OCR worker service on ${signal}...`);
  stopping = true;
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  db.close();
  process.exit(1);
});
