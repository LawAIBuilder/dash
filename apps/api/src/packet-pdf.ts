import type Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { toSafeFilesystemSegment } from "./fs-safety.js";

export const PACKET_PDF_MANIFEST_VERSION = 2 as const;

/** @deprecated Legacy alias — new exports use manifest version 2. */
export const PACKET_PDF_MANIFEST_VERSION_LEGACY = 1 as const;

export type PacketPdfPageEntry = {
  packet_page_number: number;
  section_key: string;
  section_label: string;
  exhibit_id: string;
  exhibit_label: string;
  exhibit_title: string | null;
  exhibit_item_id: string;
  source_item_id: string;
  canonical_document_id: string;
  canonical_page_id: string;
  /** 0-based index in the source PDF */
  source_pdf_page_index: number;
};

export type BatesStampOptions = {
  prefix: string;
  start_at: number;
  padding: number;
};

export type PacketPdfExportOptions = {
  cover_sheet: boolean;
  section_separators: boolean;
  exhibit_separators: boolean;
  bates: BatesStampOptions | null;
};

export const DEFAULT_PACKET_PDF_EXPORT_OPTIONS: PacketPdfExportOptions = {
  cover_sheet: true,
  section_separators: true,
  exhibit_separators: true,
  bates: null
};

export function parsePacketPdfExportOptions(body: unknown): PacketPdfExportOptions {
  const d = DEFAULT_PACKET_PDF_EXPORT_OPTIONS;
  if (!body || typeof body !== "object") {
    return { ...d };
  }
  const o = body as Record<string, unknown>;
  let bates: BatesStampOptions | null = null;
  const batesRaw = o.bates;
  if (batesRaw !== undefined && batesRaw !== null && typeof batesRaw === "object") {
    const b = batesRaw as Record<string, unknown>;
    bates = {
      prefix: typeof b.prefix === "string" && b.prefix.trim() ? b.prefix.trim() : "WC",
      start_at: typeof b.start_at === "number" && Number.isFinite(b.start_at) ? Math.max(1, Math.floor(b.start_at)) : 1,
      padding:
        typeof b.padding === "number" && Number.isFinite(b.padding) ? Math.min(12, Math.max(1, Math.floor(b.padding))) : 6
    };
  }
  return {
    cover_sheet: typeof o.cover_sheet === "boolean" ? o.cover_sheet : d.cover_sheet,
    section_separators: typeof o.section_separators === "boolean" ? o.section_separators : d.section_separators,
    exhibit_separators: typeof o.exhibit_separators === "boolean" ? o.exhibit_separators : d.exhibit_separators,
    bates
  };
}

export type PacketPdfManifestPage =
  | {
      kind: "cover";
      packet_page_number: number;
      packet_name: string;
      case_id: string;
      case_name: string | null;
      generated_at: string;
      bates_label?: string;
    }
  | {
      kind: "section_separator";
      packet_page_number: number;
      section_key: string;
      section_label: string;
      bates_label?: string;
    }
  | {
      kind: "exhibit_separator";
      packet_page_number: number;
      section_label: string;
      exhibit_id: string;
      exhibit_label: string;
      exhibit_title: string | null;
      bates_label?: string;
    }
  | (PacketPdfPageEntry & { kind: "content"; bates_label?: string });

export type PacketPdfManifestV2 = {
  version: typeof PACKET_PDF_MANIFEST_VERSION;
  packet_id: string;
  case_id: string;
  packet_name: string;
  export_id: string;
  created_at: string;
  options: PacketPdfExportOptions;
  page_total: number;
  pages: PacketPdfManifestPage[];
  item_errors: Array<{ exhibit_item_id: string; message: string }>;
};

/** @deprecated Prefer PacketPdfManifestV2 */
export type PacketPdfManifestV1 = {
  version: typeof PACKET_PDF_MANIFEST_VERSION_LEGACY;
  packet_id: string;
  case_id: string;
  packet_name: string;
  export_id: string;
  created_at: string;
  page_total: number;
  pages: PacketPdfPageEntry[];
  item_errors: Array<{ exhibit_item_id: string; message: string }>;
};

function resolveExportBaseDir() {
  const fromEnv = process.env.WC_EXHIBIT_EXPORT_DIR?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  const dbPath = process.env.WC_SQLITE_PATH?.trim();
  if (dbPath) {
    return join(dirname(resolve(dbPath)), "exhibit_exports");
  }
  return resolve(process.cwd(), "apps/api/data/exhibit_exports");
}

type OrderedExhibitItemRow = {
  exhibit_item_id: string;
  source_item_id: string | null;
  canonical_document_id: string | null;
  canonical_page_id: string | null;
  page_start: number | null;
  page_end: number | null;
  exhibit_id: string;
  exhibit_label: string;
  exhibit_title: string | null;
  section_key: string;
  section_label: string;
};

function listOrderedExhibitItems(db: Database.Database, packetId: string): OrderedExhibitItemRow[] {
  return db
    .prepare(
      `
        SELECT
          ei.id AS exhibit_item_id,
          ei.source_item_id,
          ei.canonical_document_id,
          ei.canonical_page_id,
          ei.page_start,
          ei.page_end,
          e.id AS exhibit_id,
          e.exhibit_label,
          e.title AS exhibit_title,
          es.section_key,
          es.section_label
        FROM exhibit_items ei
        JOIN exhibits e ON e.id = ei.exhibit_id
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        WHERE es.exhibit_packet_id = ?
        ORDER BY es.sort_order ASC, e.sort_order ASC, ei.include_order ASC, ei.created_at ASC
      `
    )
    .all(packetId) as OrderedExhibitItemRow[];
}

function getExcludedPageIds(db: Database.Database, exhibitItemId: string): Set<string> {
  const rows = db
    .prepare(
      `
        SELECT canonical_page_id
        FROM exhibit_item_page_rules
        WHERE exhibit_item_id = ?
          AND rule_type = 'exclude'
      `
    )
    .all(exhibitItemId) as Array<{ canonical_page_id: string }>;
  return new Set(rows.map((row) => row.canonical_page_id));
}

export type ResolvedPagesForItem =
  | {
      ok: true;
      canonical_document_id: string;
      pages: Array<{ canonical_page_id: string; page_number_in_doc: number; source_pdf_page_index: number }>;
    }
  | { ok: false; message: string };

export function resolveIncludedPagesForExhibitItem(db: Database.Database, row: OrderedExhibitItemRow): ResolvedPagesForItem {
  if (!row.canonical_document_id) {
    return { ok: false, message: "exhibit item is missing canonical_document_id" };
  }
  const excluded = getExcludedPageIds(db, row.exhibit_item_id);
  const pageRows = db
    .prepare(
      `
        SELECT id, page_number_in_doc
        FROM canonical_pages
        WHERE canonical_doc_id = ?
        ORDER BY page_number_in_doc ASC
      `
    )
    .all(row.canonical_document_id) as Array<{ id: string; page_number_in_doc: number }>;

  if (pageRows.length === 0) {
    return { ok: false, message: "canonical document has no pages" };
  }

  let selected = pageRows;
  if (row.canonical_page_id) {
    selected = pageRows.filter((page) => page.id === row.canonical_page_id);
  } else if (row.page_start != null && row.page_end != null) {
    const a = row.page_start;
    const b = row.page_end;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    selected = pageRows.filter((page) => page.page_number_in_doc >= lo && page.page_number_in_doc <= hi);
  }

  selected = selected.filter((page) => !excluded.has(page.id));
  if (selected.length === 0) {
    return { ok: false, message: "no pages remain after inclusion rules and exclusions" };
  }

  return {
    ok: true,
    canonical_document_id: row.canonical_document_id,
    pages: selected.map((page) => ({
      canonical_page_id: page.id,
      page_number_in_doc: page.page_number_in_doc,
      source_pdf_page_index: Math.max(0, page.page_number_in_doc - 1)
    }))
  };
}

function buildContentPacketPages(
  db: Database.Database,
  packetId: string
): {
  contentPages: PacketPdfPageEntry[];
  item_errors: Array<{ exhibit_item_id: string; message: string }>;
} {
  const items = listOrderedExhibitItems(db, packetId);
  const contentPages: PacketPdfPageEntry[] = [];
  const item_errors: Array<{ exhibit_item_id: string; message: string }> = [];
  let n = 0;

  for (const row of items) {
    const resolved = resolveIncludedPagesForExhibitItem(db, row);
    if (!resolved.ok) {
      item_errors.push({ exhibit_item_id: row.exhibit_item_id, message: resolved.message });
      continue;
    }
    if (!row.source_item_id) {
      item_errors.push({ exhibit_item_id: row.exhibit_item_id, message: "exhibit item is missing source_item_id" });
      continue;
    }
    for (const p of resolved.pages) {
      n += 1;
      contentPages.push({
        packet_page_number: n,
        section_key: row.section_key,
        section_label: row.section_label,
        exhibit_id: row.exhibit_id,
        exhibit_label: row.exhibit_label,
        exhibit_title: row.exhibit_title,
        exhibit_item_id: row.exhibit_item_id,
        source_item_id: row.source_item_id,
        canonical_document_id: resolved.canonical_document_id,
        canonical_page_id: p.canonical_page_id,
        source_pdf_page_index: p.source_pdf_page_index
      });
    }
  }

  return { contentPages, item_errors };
}

function formatBatesLabel(prefix: string, sequence: number, padding: number) {
  return `${prefix}-${String(sequence).padStart(padding, "0")}`;
}

function assembleOutputPages(
  contentPages: PacketPdfPageEntry[],
  options: PacketPdfExportOptions,
  meta: {
    packet_name: string;
    case_id: string;
    case_name: string | null;
    export_id: string;
    created_at: string;
  }
): PacketPdfManifestPage[] {
  const out: PacketPdfManifestPage[] = [];
  let num = 0;
  const next = () => {
    num += 1;
    return num;
  };

  if (options.cover_sheet) {
    out.push({
      kind: "cover",
      packet_page_number: next(),
      packet_name: meta.packet_name,
      case_id: meta.case_id,
      case_name: meta.case_name,
      generated_at: meta.created_at
    });
  }

  let prevSection: string | null = null;
  let prevExhibit: string | null = null;

  for (const cp of contentPages) {
    if (options.section_separators && cp.section_key !== prevSection) {
      prevSection = cp.section_key;
      prevExhibit = null;
      out.push({
        kind: "section_separator",
        packet_page_number: next(),
        section_key: cp.section_key,
        section_label: cp.section_label
      });
    }
    if (options.exhibit_separators && cp.exhibit_id !== prevExhibit) {
      prevExhibit = cp.exhibit_id;
      out.push({
        kind: "exhibit_separator",
        packet_page_number: next(),
        section_label: cp.section_label,
        exhibit_id: cp.exhibit_id,
        exhibit_label: cp.exhibit_label,
        exhibit_title: cp.exhibit_title
      });
    }
    out.push({
      kind: "content",
      packet_page_number: next(),
      section_key: cp.section_key,
      section_label: cp.section_label,
      exhibit_id: cp.exhibit_id,
      exhibit_label: cp.exhibit_label,
      exhibit_title: cp.exhibit_title,
      exhibit_item_id: cp.exhibit_item_id,
      source_item_id: cp.source_item_id,
      canonical_document_id: cp.canonical_document_id,
      canonical_page_id: cp.canonical_page_id,
      source_pdf_page_index: cp.source_pdf_page_index
    });
  }

  if (!options.bates) {
    return out;
  }
  const { prefix, start_at, padding } = options.bates;
  return out.map((page, index) => ({
    ...page,
    bates_label: formatBatesLabel(prefix, start_at + index, padding)
  })) as PacketPdfManifestPage[];
}

export function buildPacketPdfManifest(
  db: Database.Database,
  packetId: string,
  exportId: string,
  options: PacketPdfExportOptions = DEFAULT_PACKET_PDF_EXPORT_OPTIONS
): PacketPdfManifestV2 | null {
  const packet = db
    .prepare(`SELECT id, case_id, packet_name FROM exhibit_packets WHERE id = ? LIMIT 1`)
    .get(packetId) as { id: string; case_id: string; packet_name: string } | undefined;
  if (!packet) {
    return null;
  }
  const caseRow = db.prepare(`SELECT name FROM cases WHERE id = ? LIMIT 1`).get(packet.case_id) as { name: string } | undefined;
  const created_at = new Date().toISOString();
  const { contentPages, item_errors } = buildContentPacketPages(db, packetId);
  if (contentPages.length === 0) {
    return {
      version: PACKET_PDF_MANIFEST_VERSION,
      packet_id: packet.id,
      case_id: packet.case_id,
      packet_name: packet.packet_name,
      export_id: exportId,
      created_at,
      options: { ...options },
      page_total: 0,
      pages: [],
      item_errors
    };
  }

  const pages = assembleOutputPages(contentPages, options, {
    packet_name: packet.packet_name,
    case_id: packet.case_id,
    case_name: caseRow?.name ?? null,
    export_id: exportId,
    created_at
  });

  return {
    version: PACKET_PDF_MANIFEST_VERSION,
    packet_id: packet.id,
    case_id: packet.case_id,
    packet_name: packet.packet_name,
    export_id: exportId,
    created_at,
    options: { ...options },
    page_total: pages.length,
    pages,
    item_errors
  };
}

export type FetchPdfBytes = (sourceItemId: string) => Promise<Buffer>;

const LETTER_W = 612;
const LETTER_H = 792;

function drawTextLine(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = rgb(0.2, 0.2, 0.22)) {
  const max = 72;
  const line = text.length > max ? `${text.slice(0, max - 3)}...` : text;
  page.drawText(line, { x, y, size, font, color });
}

function drawCoverPage(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  data: { packet_name: string; case_id: string; case_name: string | null; generated_at: string }
) {
  const { width, height } = page.getSize();
  const heading = "Exhibit Packet";
  const hs = 22;
  const hw = bold.widthOfTextAtSize(heading, hs);
  page.drawText(heading, {
    x: (width - hw) / 2,
    y: height - 120,
    size: hs,
    font: bold,
    color: rgb(0.08, 0.08, 0.1)
  });
  let y = height - 190;
  const lines: string[] = [];
  if (data.case_name?.trim()) {
    lines.push(data.case_name.trim());
  }
  lines.push(data.packet_name);
  lines.push(`Matter ID: ${data.case_id}`);
  lines.push(`Generated: ${data.generated_at}`);
  for (const line of lines) {
    drawTextLine(page, line, 72, y, 11, font);
    y -= 20;
  }
}

function drawSectionSeparatorPage(page: PDFPage, font: PDFFont, bold: PDFFont, section_label: string) {
  const { width, height } = page.getSize();
  const label = "Section";
  const ls = 12;
  const lw = font.widthOfTextAtSize(label, ls);
  page.drawText(label, {
    x: (width - lw) / 2,
    y: height / 2 + 36,
    size: ls,
    font,
    color: rgb(0.45, 0.45, 0.48)
  });
  const ts = 18;
  const tw = bold.widthOfTextAtSize(section_label, ts);
  page.drawText(section_label, {
    x: (width - tw) / 2,
    y: height / 2,
    size: ts,
    font: bold,
    color: rgb(0.12, 0.12, 0.14)
  });
}

function drawExhibitSeparatorPage(page: PDFPage, font: PDFFont, bold: PDFFont, exhibit_label: string, exhibit_title: string | null) {
  const { width, height } = page.getSize();
  const line1 = `Exhibit ${exhibit_label}`;
  const s1 = 18;
  const w1 = bold.widthOfTextAtSize(line1, s1);
  page.drawText(line1, {
    x: (width - w1) / 2,
    y: height / 2 + 14,
    size: s1,
    font: bold,
    color: rgb(0.12, 0.12, 0.14)
  });
  if (exhibit_title?.trim()) {
    const raw = exhibit_title.trim();
    const display = raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
    const s2 = 12;
    const w2 = font.widthOfTextAtSize(display, s2);
    page.drawText(display, {
      x: (width - w2) / 2,
      y: height / 2 - 18,
      size: s2,
      font,
      color: rgb(0.35, 0.35, 0.38)
    });
  }
}

export async function renderPacketPdfToBuffer(
  db: Database.Database,
  packetId: string,
  fetchPdfBytes: FetchPdfBytes,
  options: PacketPdfExportOptions = DEFAULT_PACKET_PDF_EXPORT_OPTIONS
): Promise<
  | { ok: true; pdf: Uint8Array; manifest: PacketPdfManifestV2 }
  | { ok: false; error: string; manifest: PacketPdfManifestV2 | null }
> {
  const exportId = randomUUID();
  const manifest = buildPacketPdfManifest(db, packetId, exportId, options);
  if (!manifest) {
    return { ok: false, error: "packet not found", manifest: null };
  }
  if (manifest.pages.length === 0) {
    return {
      ok: false,
      error:
        manifest.item_errors.length > 0
          ? `no pages to render: ${manifest.item_errors.map((e) => e.message).join("; ")}`
          : "no exhibit items in packet",
      manifest
    };
  }

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const sourceCache = new Map<string, PDFDocument>();

  try {
    for (const entry of manifest.pages) {
      if (entry.kind === "cover") {
        const page = out.addPage([LETTER_W, LETTER_H]);
        drawCoverPage(page, font, bold, {
          packet_name: entry.packet_name,
          case_id: entry.case_id,
          case_name: entry.case_name,
          generated_at: entry.generated_at
        });
        continue;
      }
      if (entry.kind === "section_separator") {
        const page = out.addPage([LETTER_W, LETTER_H]);
        drawSectionSeparatorPage(page, font, bold, entry.section_label);
        continue;
      }
      if (entry.kind === "exhibit_separator") {
        const page = out.addPage([LETTER_W, LETTER_H]);
        drawExhibitSeparatorPage(page, font, bold, entry.exhibit_label, entry.exhibit_title);
        continue;
      }
      let sourceDoc = sourceCache.get(entry.source_item_id);
      if (!sourceDoc) {
        const bytes = await fetchPdfBytes(entry.source_item_id);
        sourceDoc = await PDFDocument.load(bytes, { ignoreEncryption: false });
        sourceCache.set(entry.source_item_id, sourceDoc);
      }
      const pageCount = sourceDoc.getPageCount();
      if (entry.source_pdf_page_index < 0 || entry.source_pdf_page_index >= pageCount) {
        return {
          ok: false,
          error: `source PDF page index ${entry.source_pdf_page_index} out of range (document has ${pageCount} pages)`,
          manifest
        };
      }
      const [copied] = await out.copyPages(sourceDoc, [entry.source_pdf_page_index]);
      out.addPage(copied);
    }

    if (options.bates) {
      const pages = out.getPages();
      for (let i = 0; i < pages.length; i++) {
        const label = manifest.pages[i]?.bates_label;
        if (!label) {
          continue;
        }
        const pg = pages[i];
        const { width } = pg.getSize();
        const size = 9;
        const tw = font.widthOfTextAtSize(label, size);
        pg.drawText(label, {
          x: width - 52 - tw,
          y: 36,
          size,
          font,
          color: rgb(0.22, 0.22, 0.24)
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, manifest };
  }

  const pdf = await out.save();
  return { ok: true, pdf, manifest };
}

export function insertPacketExportRow(
  db: Database.Database,
  input: {
    id: string;
    caseId: string;
    packetId: string;
    status: "pending" | "complete" | "failed";
    pdfRelativePath?: string | null;
    manifestJson?: string | null;
    errorText?: string | null;
    pageCount?: number | null;
  }
) {
  db.prepare(
    `
      INSERT INTO exhibit_packet_exports
        (id, case_id, packet_id, status, export_type, pdf_relative_path, manifest_json, error_text, page_count, completed_at)
      VALUES
        (?, ?, ?, ?, 'packet_pdf', ?, ?, ?, ?, ?)
    `
  ).run(
    input.id,
    input.caseId,
    input.packetId,
    input.status,
    input.pdfRelativePath ?? null,
    input.manifestJson ?? null,
    input.errorText ?? null,
    input.pageCount ?? null,
    input.status === "pending" ? null : new Date().toISOString()
  );
}

export function updatePacketExportRow(
  db: Database.Database,
  exportId: string,
  input: {
    status: "complete" | "failed";
    pdfRelativePath?: string | null;
    manifestJson?: string | null;
    errorText?: string | null;
    pageCount?: number | null;
  }
) {
  db.prepare(
    `
      UPDATE exhibit_packet_exports
      SET status = ?,
          pdf_relative_path = COALESCE(?, pdf_relative_path),
          manifest_json = COALESCE(?, manifest_json),
          error_text = ?,
          page_count = COALESCE(?, page_count),
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    input.status,
    input.pdfRelativePath ?? null,
    input.manifestJson ?? null,
    input.errorText ?? null,
    input.pageCount ?? null,
    exportId
  );
}

export function reconcileStalePacketExports(
  db: Database.Database,
  input?: {
    staleAfterMinutes?: number;
    errorText?: string;
  }
) {
  const staleAfterMinutes = Math.max(1, Math.floor(input?.staleAfterMinutes ?? 30));
  const errorText = input?.errorText?.trim() || "Packet PDF export reconciled after incomplete shutdown";
  const threshold = `-${staleAfterMinutes} minutes`;

  const run = db.prepare(
    `
      UPDATE exhibit_packet_exports
      SET status = 'failed',
          error_text = COALESCE(NULLIF(error_text, ''), ?),
          completed_at = CURRENT_TIMESTAMP
      WHERE status = 'pending'
        AND completed_at IS NULL
        AND created_at <= datetime('now', ?)
    `
  ).run(errorText, threshold);

  return run.changes;
}

export function getPacketExportRow(db: Database.Database, exportId: string) {
  return db
    .prepare(
      `
        SELECT id, case_id, packet_id, status, export_type, pdf_relative_path, manifest_json, error_text, page_count, created_at, completed_at
        FROM exhibit_packet_exports
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(exportId) as
    | {
        id: string;
        case_id: string;
        packet_id: string;
        status: string;
        export_type: string;
        pdf_relative_path: string | null;
        manifest_json: string | null;
        error_text: string | null;
        page_count: number | null;
        created_at: string;
        completed_at: string | null;
      }
    | undefined;
}

export function listPacketExportsForPacket(db: Database.Database, packetId: string) {
  return db
    .prepare(
      `
        SELECT id, case_id, packet_id, status, export_type, pdf_relative_path, manifest_json, error_text, page_count, created_at, completed_at
        FROM exhibit_packet_exports
        WHERE packet_id = ?
        ORDER BY created_at DESC
      `
    )
    .all(packetId) as Array<{
    id: string;
    case_id: string;
    packet_id: string;
    status: string;
    export_type: string;
    pdf_relative_path: string | null;
    manifest_json: string | null;
    error_text: string | null;
    page_count: number | null;
    created_at: string;
    completed_at: string | null;
  }>;
}

export function resolveExportAbsolutePath(relativePath: string) {
  return join(resolveExportBaseDir(), relativePath);
}

/** Allowed packet statuses for PDF export (post-finalize workflow). */
const EXPORTABLE_PACKET_STATUSES = new Set(["finalized", "needs_review", "exported"]);

export async function runPacketPdfExport(
  db: Database.Database,
  packetId: string,
  fetchPdfBytes: FetchPdfBytes,
  options: PacketPdfExportOptions = DEFAULT_PACKET_PDF_EXPORT_OPTIONS
): Promise<
  | { ok: true; exportId: string; relativePdfPath: string; manifest: PacketPdfManifestV2; pageCount: number }
  | { ok: false; exportId?: string; error: string; manifest?: PacketPdfManifestV2 | null }
> {
  const packet = db
    .prepare(`SELECT id, case_id, packet_name, status FROM exhibit_packets WHERE id = ? LIMIT 1`)
    .get(packetId) as { id: string; case_id: string; packet_name: string; status: string } | undefined;
  if (!packet) {
    return { ok: false, error: "packet not found" };
  }
  if (!EXPORTABLE_PACKET_STATUSES.has(packet.status)) {
    return {
      ok: false,
      error: `packet status must be export-ready (${Array.from(EXPORTABLE_PACKET_STATUSES).join(", ")}; current: ${packet.status})`
    };
  }

  const exportId = randomUUID();
  const baseDir = resolveExportBaseDir();
  const caseDirSegment = toSafeFilesystemSegment(packet.case_id, "case");
  const caseDir = join(baseDir, caseDirSegment);
  await mkdir(caseDir, { recursive: true });

  insertPacketExportRow(db, {
    id: exportId,
    caseId: packet.case_id,
    packetId: packet.id,
    status: "pending"
  });

  const render = await renderPacketPdfToBuffer(db, packetId, fetchPdfBytes, options);
  if (!render.ok || !render.manifest) {
    updatePacketExportRow(db, exportId, {
      status: "failed",
      errorText: render.ok === false ? render.error : "unknown failure",
      manifestJson: render.manifest ? JSON.stringify(render.manifest) : null
    });
    return { ok: false, exportId, error: render.ok === false ? render.error : "render failed", manifest: render.manifest };
  }

  const fileBase = `${exportId}.pdf`;
  const relativePath = join(caseDirSegment, fileBase);
  const absPdf = join(baseDir, relativePath);
  await writeFile(absPdf, render.pdf);

  const manifestJson = JSON.stringify(render.manifest);
  await writeFile(join(caseDir, `${exportId}.manifest.json`), manifestJson, "utf8");

  updatePacketExportRow(db, exportId, {
    status: "complete",
    pdfRelativePath: relativePath,
    manifestJson,
    pageCount: render.manifest.page_total,
    errorText: null
  });

  db.prepare(
    `
      INSERT INTO exhibit_history
        (id, packet_id, actor_id, action_type, target_type, target_id, payload_json)
      VALUES
        (?, ?, NULL, 'packet_pdf_exported', 'export', ?, ?)
    `
  ).run(
    randomUUID(),
    packet.id,
    exportId,
    JSON.stringify({ page_count: render.manifest.page_total, export_id: exportId, layout: options })
  );

  db.prepare(`UPDATE exhibit_packets SET status = 'exported', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(packet.id);

  return {
    ok: true,
    exportId,
    relativePdfPath: relativePath,
    manifest: render.manifest,
    pageCount: render.manifest.page_total
  };
}
