/**
 * Drain queued OCR attempts. Run beside the API with the same env + SQLite path.
 *
 *   npm run ocr-worker --workspace @wc/api
 */
import { openDatabase } from "./db.js";
import { runOcrWorkerLoop } from "./ocr-worker.js";
import { seedFoundation } from "./seed.js";

const db = openDatabase();
seedFoundation(db);

const maxPasses = Number(process.env.OCR_WORKER_MAX_PASSES ?? 100);

runOcrWorkerLoop(db, Number.isFinite(maxPasses) ? maxPasses : 100)
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
