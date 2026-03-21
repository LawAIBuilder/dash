/**
 * Long-running OCR worker for shared deployment environments.
 * Runs beside the API, polling the same SQLite DB on an interval.
 */
import { openDatabase } from "./db.js";
import { runOcrWorkerLoop } from "./ocr-worker.js";

const db = openDatabase();

const maxPasses = Number(process.env.OCR_WORKER_MAX_PASSES ?? 25);
const intervalMs = Number(process.env.OCR_WORKER_INTERVAL_MS ?? 15000);

let stopping = false;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`OCR worker service started (maxPasses=${maxPasses}, intervalMs=${intervalMs}).`);

  while (!stopping) {
    try {
      const { processed } = await runOcrWorkerLoop(
        db,
        Number.isFinite(maxPasses) ? maxPasses : 25
      );
      if (processed > 0) {
        // eslint-disable-next-line no-console
        console.log(`OCR worker pass processed ${processed} attempt(s).`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("OCR worker loop error", error);
    }

    if (!stopping) {
      await sleep(Number.isFinite(intervalMs) ? intervalMs : 15000);
    }
  }

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
