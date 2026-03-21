/**
 * Drain queued OCR attempts. Run beside the API with the same env + SQLite path.
 *
 *   npm run ocr-worker --workspace @wc/api
 */
import { openDatabase } from "./db.js";
import { readPositiveIntegerEnv } from "./env.js";
import { runOcrWorkerLoop } from "./ocr-worker.js";

const db = openDatabase();

const maxPasses = readPositiveIntegerEnv("OCR_WORKER_MAX_PASSES", 100, { min: 1 });

runOcrWorkerLoop(db, maxPasses)
  .then(({ processed }) => {
    // eslint-disable-next-line no-console
    console.log(`OCR worker finished. Processed ${processed} attempt(s).`);
    db.close();
    process.exit(0);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    db.close();
    process.exit(1);
  });
