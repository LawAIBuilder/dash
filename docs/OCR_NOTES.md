# OCR implementation notes

## Architecture

The OCR worker (`apps/api/src/ocr-worker.ts`) processes queued `ocr_attempts` rows using a three-tier strategy:

1. **PDF text layer** (fast path) -- uses `pdfjs-dist` to extract embedded text from digitally-created PDFs. If >= 40 chars are found, the page is complete at confidence 1.0 with no rasterization or Tesseract.
2. **PDF raster + Tesseract** (fallback) -- rasterizes the page to PNG via `pdf-to-img`, then runs Tesseract OCR. Used for scanned documents where the text layer is empty or insufficient.
3. **Image Tesseract** (direct) -- for non-PDF image files (PNG, JPEG, TIFF), runs Tesseract directly on the file bytes.

Unsupported formats (xlsx, docx, zip, etc.) are detected by extension and marked `review_required` with a `skipped_unsupported_format` metadata path.

## The pdfjs-dist version conflict

**Problem:** The original implementation used `pdf-parse` (npm) for text layer extraction and `pdf-to-img` for rasterization. Both libraries bundle their own `pdfjs-dist`: `pdf-parse@2.4.5` bundles `pdfjs-dist@5.4.296`, while `pdf-to-img@5.0.0` bundles `pdfjs-dist@5.4.624`. When both are loaded in the same Node process, the pdfjs WASM worker initializes with one version but the API expects another, producing:

```
The API version "5.4.624" does not match the Worker version "5.4.296".
```

This error surfaces during rasterization (the second library to load), which means it appears to happen "near" Tesseract but is actually a pdfjs-dist conflict. Every scanned PDF fails because text layer extraction (via pdf-parse) works, but rasterization (via pdf-to-img) crashes.

**Fix:** Removed `pdf-parse` entirely. Text layer extraction now uses `pdfjs-dist/legacy/build/pdf.mjs` directly -- the same `pdfjs-dist` version that `pdf-to-img` resolves to. This keeps a single pdfjs-dist version in the process.

**Rule:** Never add a second library that vendors its own `pdfjs-dist` build. If you need PDF capabilities, use `pdfjs-dist` directly or ensure the library shares the same resolved version.

## Performance characteristics (Gayle Hagberg - 24082, 98 pages)

| Path | Pages | Avg time/page | Avg text | Avg confidence |
|------|-------|---------------|----------|----------------|
| pdf_text_layer | ~57 | < 100ms | 1,463 chars | 100% |
| tesseract_pdf_raster | ~29 | ~3s | 1,770 chars | 81% |
| review_required | ~12 | -- | 0 chars | -- |

Total matter OCR time: ~3-4 minutes for 98 pages (dominated by Box API calls + Tesseract on scanned pages).

## Tesseract.js version

Use `tesseract.js@5.x` (v5.1.1 known working). Version 7.x has a WASM API/Worker version mismatch bug in Node.js environments as of early 2026.

## Format handling

| Format | OCR path | Notes |
|--------|----------|-------|
| PDF (digital) | text layer | Instant, confidence 1.0 |
| PDF (scanned) | rasterize + Tesseract | ~3s/page, confidence varies |
| PNG/JPEG/TIFF | Tesseract direct | For image-only source items |
| XLSX/XLS/CSV | skipped | Needs spreadsheet parser, not OCR |
| DOCX/DOC/PPT | skipped | Needs document parser, not OCR |
| ZIP/RAR/MSG | skipped | Archive/email, not OCR-able |

## Running the worker

```bash
# Process up to 100 queued attempts (default)
npm run ocr-worker --workspace @wc/api

# Custom batch size
OCR_WORKER_MAX_PASSES=500 npm run ocr-worker --workspace @wc/api
```

The worker shares the same SQLite database and env config as the API server. Run it alongside or after the API has queued work via normalize + queue OCR.
