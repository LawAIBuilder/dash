const OFFICE_EXTENSIONS = new Set([
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

/**
 * Hint when inventory filenames look like formats the OCR worker skips.
 */
export function officeFormatHintFromTitle(title: string | null | undefined): string | null {
  if (!title?.trim()) {
    return null;
  }
  const parts = title.trim().split(".");
  if (parts.length < 2) {
    return null;
  }
  const ext = (parts.pop() ?? "").toLowerCase();
  if (!OFFICE_EXTENSIONS.has(ext)) {
    return null;
  }
  return `Office/binary format (.${ext}): the OCR worker skips these; open in the native app or export to PDF for text.`;
}
