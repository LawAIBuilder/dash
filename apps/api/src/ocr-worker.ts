import type Database from "better-sqlite3";
import { createWorker } from "tesseract.js";
import { createBoxClient, downloadBoxFileContent, resolveBoxProviderConfig } from "./box-provider.js";
import { extractPdfPageText, rasterizePdfPageToPng } from "./pdf-rasterize.js";
import { recordCanonicalPageOcrAttempt, resolvePageAssetContext } from "./runtime.js";

const UNSUPPORTED_OCR_EXTENSIONS = new Set([
  "xlsx",
  "xls",
  "csv",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "zip",
  "rar",
  "7z",
  "msg",
  "eml"
]);

const TEXT_LAYER_MIN_CHARS = 40;

type BoxSdkClient = ReturnType<typeof createBoxClient>["client"];
type TessWorker = Awaited<ReturnType<typeof createWorker>>;

export type OcrWorkerLoopDeps = {
  boxClient: BoxSdkClient | null;
  ensureTesseract: () => Promise<TessWorker>;
};

export function claimQueuedOcrAttempt(db: Database.Database) {
  return db.transaction(() => {
    const row = db
      .prepare(
        `
          SELECT id, canonical_page_id, engine
          FROM ocr_attempts
          WHERE status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
        `
      )
      .get() as { id: string; canonical_page_id: string; engine: string } | undefined;
    if (!row) {
      return null;
    }
    const run = db.prepare(`UPDATE ocr_attempts SET status = 'processing' WHERE id = ? AND status = 'queued'`).run(row.id);
    if (run.changes === 0) {
      return null;
    }
    return row;
  })();
}

function finalizeAttempt(
  db: Database.Database,
  attemptId: string,
  canonicalPageId: string,
  result:
    | {
        ok: true;
        engine: string;
        status: string;
        outputText?: string;
        confidence?: number | null;
        metadata?: unknown;
      }
    | { ok: false; engine: string; message: string }
) {
  db.transaction(() => {
    db.prepare(`DELETE FROM ocr_attempts WHERE id = ?`).run(attemptId);
    if (result.ok) {
      recordCanonicalPageOcrAttempt(db, {
        canonicalPageId,
        engine: result.engine,
        status: result.status,
        outputText: result.outputText ?? null,
        confidence: result.confidence ?? null,
        metadataJson: result.metadata
      });
    } else {
      recordCanonicalPageOcrAttempt(db, {
        canonicalPageId,
        engine: result.engine,
        status: "failed",
        outputText: null,
        confidence: null,
        metadataJson: { error: result.message }
      });
    }
  })();
}

function looksLikePdf(buffer: Buffer): boolean {
  if (buffer.length < 5) {
    return false;
  }
  const head = buffer.subarray(0, 5).toString("latin1");
  return head === "%PDF-";
}

async function tesseractOnImage(buffer: Buffer, ensureShared?: () => Promise<TessWorker>) {
  if (ensureShared) {
    const worker = await ensureShared();
    const {
      data: { text, confidence }
    } = await worker.recognize(buffer);
    return { text: text.trim(), confidence: confidence ?? null };
  }

  const worker = await createWorker("eng");
  try {
    const {
      data: { text, confidence }
    } = await worker.recognize(buffer);
    return { text: text.trim(), confidence: confidence ?? null };
  } finally {
    await worker.terminate();
  }
}

/**
 * Process one queued OCR attempt (Box file → text layer or raster + Tesseract).
 * Returns true if an attempt was claimed (whether or not it succeeded).
 */
export async function processOneOcrAttempt(db: Database.Database, deps?: OcrWorkerLoopDeps): Promise<boolean> {
  const claim = claimQueuedOcrAttempt(db);
  if (!claim) {
    return false;
  }

  const ctx = resolvePageAssetContext(db, claim.canonical_page_id);
  if (!ctx || !ctx.sourceItemId || !ctx.remoteId) {
    finalizeAttempt(db, claim.id, claim.canonical_page_id, {
      ok: false,
      engine: claim.engine,
      message: "Could not resolve source item / remote id for canonical page"
    });
    return true;
  }

  if (ctx.provider !== "box") {
    finalizeAttempt(db, claim.id, claim.canonical_page_id, {
      ok: false,
      engine: claim.engine,
      message: `Provider ${ctx.provider ?? "unknown"} not supported by OCR worker`
    });
    return true;
  }

  const config = resolveBoxProviderConfig();
  if (!config) {
    finalizeAttempt(db, claim.id, claim.canonical_page_id, {
      ok: false,
      engine: claim.engine,
      message: "Box JWT config missing (BOX_JWT_CONFIG_JSON / BOX_JWT_CONFIG_FILE)"
    });
    return true;
  }

  let buffer: Buffer;
  try {
    const client = deps?.boxClient ?? createBoxClient(config).client;
    buffer = await downloadBoxFileContent(client, ctx.remoteId);
  } catch (error) {
    finalizeAttempt(db, claim.id, claim.canonical_page_id, {
      ok: false,
      engine: claim.engine,
      message: error instanceof Error ? error.message : "Box download failed"
    });
    return true;
  }

  const mime = (ctx.mimeType ?? "").toLowerCase();
  const fileName = (ctx.title ?? "").toLowerCase();
  const ext = fileName.split(".").pop() ?? "";
  const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "tif", "tiff", "bmp"]);
  const isPdf = mime.includes("pdf") || ext === "pdf" || looksLikePdf(buffer);
  const isImage =
    mime.includes("png") ||
    mime.includes("jpeg") ||
    mime.includes("jpg") ||
    mime.includes("tif") ||
    IMAGE_EXTENSIONS.has(ext);

  if (!isPdf && !isImage && UNSUPPORTED_OCR_EXTENSIONS.has(ext)) {
    finalizeAttempt(db, claim.id, claim.canonical_page_id, {
      ok: true,
      engine: claim.engine,
      status: "review_required",
      outputText: "",
      confidence: null,
      metadata: { path: "skipped_unsupported_format", mime_type: ctx.mimeType, extension: ext }
    });
    return true;
  }

  const tess = deps?.ensureTesseract;

  try {
    if (isPdf) {
      if (claim.engine !== "vision_local") {
        try {
          const textLayerText = await extractPdfPageText(buffer, ctx.pageNumberInDoc);
          if (textLayerText.length >= TEXT_LAYER_MIN_CHARS) {
            finalizeAttempt(db, claim.id, claim.canonical_page_id, {
              ok: true,
              engine: "pdf_text_layer",
              status: "complete",
              outputText: textLayerText,
              confidence: 1,
              metadata: { path: "pdf_text_layer", chars: textLayerText.length, requested_engine: claim.engine }
            });
            return true;
          }
        } catch {
          // text layer extraction failed; fall through to rasterize + Tesseract
        }
      }

      const png = await rasterizePdfPageToPng(buffer, ctx.pageNumberInDoc);
      const { text, confidence } = await tesseractOnImage(png, tess);
      if (text.length === 0) {
        finalizeAttempt(db, claim.id, claim.canonical_page_id, {
          ok: true,
          engine: claim.engine,
          status: "review_required",
          outputText: "",
          confidence,
          metadata: { path: "tesseract_pdf_raster", empty_text: true }
        });
      } else {
        const lowConf = confidence !== null && confidence < 60;
        finalizeAttempt(db, claim.id, claim.canonical_page_id, {
          ok: true,
          engine: claim.engine,
          status: lowConf ? "review_required" : "complete",
          outputText: text,
          confidence,
          metadata: { path: "tesseract_pdf_raster" }
        });
      }
      return true;
    }

    if (isImage) {
      const { text, confidence } = await tesseractOnImage(buffer, tess);
      const lowConf = confidence !== null && confidence < 60;
      finalizeAttempt(db, claim.id, claim.canonical_page_id, {
        ok: true,
        engine: claim.engine,
        status: text.length === 0 ? "review_required" : lowConf ? "review_required" : "complete",
        outputText: text,
        confidence,
        metadata: { path: "tesseract_image" }
      });
      return true;
    }

    finalizeAttempt(db, claim.id, claim.canonical_page_id, {
      ok: true,
      engine: claim.engine,
      status: "review_required",
      outputText: "",
      confidence: null,
      metadata: { path: "skipped_unknown_format", mime_type: ctx.mimeType, extension: ext }
    });
    return true;
  } catch (error) {
    finalizeAttempt(db, claim.id, claim.canonical_page_id, {
      ok: false,
      engine: claim.engine,
      message: error instanceof Error ? error.message : "OCR pipeline error"
    });
    return true;
  }
}

export async function runOcrWorkerLoop(db: Database.Database, maxPasses: number): Promise<{ processed: number }> {
  const config = resolveBoxProviderConfig();
  const boxClient = config ? createBoxClient(config).client : null;
  const tesseractHolder: { worker: TessWorker | null } = { worker: null };
  const ensureTesseract = async () => {
    if (!tesseractHolder.worker) {
      tesseractHolder.worker = await createWorker("eng");
    }
    return tesseractHolder.worker;
  };

  const deps: OcrWorkerLoopDeps = { boxClient, ensureTesseract };

  let processed = 0;
  try {
    for (let i = 0; i < maxPasses; i++) {
      const more = await processOneOcrAttempt(db, deps);
      if (!more) {
        break;
      }
      processed += 1;
    }
  } finally {
    if (tesseractHolder.worker) {
      await tesseractHolder.worker.terminate().catch(() => undefined);
    }
  }
  return { processed };
}
