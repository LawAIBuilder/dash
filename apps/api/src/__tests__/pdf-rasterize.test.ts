import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_PDF_BYTES, extractPdfPageText, rasterizePdfPageToPng } from "../pdf-rasterize.js";

describe("pdf-rasterize", () => {
  it("rejects buffers over max size", async () => {
    const huge = Buffer.alloc(DEFAULT_MAX_PDF_BYTES + 1, 0);
    await expect(rasterizePdfPageToPng(huge, 1)).rejects.toThrow(/larger than/);
  });

  it("rejects text extraction for buffers over max size", async () => {
    const huge = Buffer.alloc(DEFAULT_MAX_PDF_BYTES + 1, 0);
    await expect(extractPdfPageText(huge, 1)).rejects.toThrow(/larger than/);
  });
});
