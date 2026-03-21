import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

/**
 * Build a simple DOCX from markdown-like plain text (paragraphs split on blank lines).
 * For alpha: headings lines starting with # become headings; **bold** segments become bold runs (simple parse).
 */
export async function markdownishToDocxBuffer(markdown: string): Promise<Buffer> {
  const lines = markdown.split(/\r?\n/);
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          text: trimmed.slice(4),
          heading: HeadingLevel.HEADING_3
        })
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          text: trimmed.slice(3),
          heading: HeadingLevel.HEADING_2
        })
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          text: trimmed.slice(2),
          heading: HeadingLevel.HEADING_1
        })
      );
      continue;
    }

    const runs = simpleMarkdownRuns(trimmed);
    paragraphs.push(new Paragraph({ children: runs }));
  }

  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: [new TextRun("")] }));
  }

  const doc = new Document({
    sections: [
      {
        children: paragraphs
      }
    ]
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function simpleMarkdownRuns(line: string): TextRun[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  const runs: TextRun[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else {
      runs.push(new TextRun(part));
    }
  }
  return runs.length > 0 ? runs : [new TextRun(line)];
}
