import { pdf } from "pdf-to-img";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Default cap to avoid huge PDFs exhausting memory in-process (dogfood). */
export const DEFAULT_MAX_PDF_BYTES = 45 * 1024 * 1024;

/**
 * Extract the embedded text layer from a single PDF page using pdfjs-dist
 * (same pdfjs version as pdf-to-img -- avoids the dual-pdfjs version conflict).
 * Returns empty string for scanned pages with no text layer.
 */
export async function extractPdfPageText(
  buffer: Buffer,
  pageNumber1Based: number,
  options?: { maxPdfBytes?: number }
): Promise<string> {
  const maxBytes = options?.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
  if (buffer.length > maxBytes) {
    throw new Error(`PDF larger than ${maxBytes} bytes; increase maxPdfBytes or split the asset`);
  }
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    if (pageNumber1Based < 1 || pageNumber1Based > doc.numPages) {
      return "";
    }
    const page = await doc.getPage(pageNumber1Based);
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items) {
      if ("str" in item && typeof item.str === "string") {
        parts.push(item.str);
      }
    }
    return parts.join(" ").trim();
  } finally {
    doc.destroy();
  }
}

/**
 * Rasterize a single PDF page to PNG bytes using pdfjs via pdf-to-img (in-process, no native mutool/pdfium).
 */
export async function rasterizePdfPageToPng(
  buffer: Buffer,
  pageNumber1Based: number,
  options?: { scale?: number; maxPdfBytes?: number }
): Promise<Buffer> {
  const maxBytes = options?.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
  if (buffer.length > maxBytes) {
    throw new Error(`PDF larger than ${maxBytes} bytes; increase maxPdfBytes or split the asset`);
  }
  if (pageNumber1Based < 1) {
    throw new Error("pageNumber1Based must be >= 1");
  }

  const doc = await pdf(buffer, { scale: options?.scale ?? 2 });
  if (pageNumber1Based > doc.length) {
    throw new Error(`Page ${pageNumber1Based} out of range (document has ${doc.length} pages)`);
  }

  return doc.getPage(pageNumber1Based);
}
