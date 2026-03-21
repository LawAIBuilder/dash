import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Max markdown body length (create/update/render input). */
export const MAX_TEMPLATE_BODY_MARKDOWN = 100_000;
/** Max JSON size for values_json on save. */
export const MAX_VALUES_JSON_BYTES = 200_000;
/** Max length for a single placeholder value string. */
export const MAX_SINGLE_PLACEHOLDER_VALUE = 20_000;

export type TemplateFieldDef = {
  name: string;
  label?: string;
  default?: string | null;
};

export type UserDocumentTemplateRow = {
  id: string;
  case_id: string;
  name: string;
  description: string | null;
  body_markdown: string;
  fields_json: string;
  ai_hints: string | null;
  created_at: string;
  updated_at: string;
};

export type UserDocumentTemplateFillRow = {
  id: string;
  template_id: string;
  case_id: string;
  values_json: string;
  rendered_markdown: string;
  source_item_id: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
};

function humanizeFieldName(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function extractPlaceholderNames(body: string): string[] {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    names.add(m[1]!);
  }
  return [...names];
}

export function inferFieldsFromBody(body: string): TemplateFieldDef[] {
  return extractPlaceholderNames(body).map((name) => ({
    name,
    label: humanizeFieldName(name),
    default: ""
  }));
}

export function mergeFieldDefs(inferred: TemplateFieldDef[], explicit: TemplateFieldDef[] | null | undefined): TemplateFieldDef[] {
  if (!explicit?.length) {
    return inferred;
  }
  const byName = new Map<string, TemplateFieldDef>();
  for (const f of inferred) {
    byName.set(f.name, f);
  }
  for (const f of explicit) {
    const base = byName.get(f.name) ?? { name: f.name, label: f.label || humanizeFieldName(f.name) };
    byName.set(f.name, {
      name: f.name,
      label: f.label?.trim() || base.label,
      default: f.default ?? base.default ?? ""
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function fieldDefMap(fields: TemplateFieldDef[] | null | undefined): Map<string, TemplateFieldDef> {
  return new Map((fields ?? []).map((f) => [f.name, f]));
}

/**
 * Resolves `{{placeholders}}` using user values first, then field defaults from `fieldDefs`.
 */
export function renderUserTemplate(
  body: string,
  values: Record<string, string>,
  fieldDefs?: TemplateFieldDef[] | null
): { rendered_markdown: string; missing_placeholders: string[] } {
  const missing: string[] = [];
  const byName = fieldDefMap(fieldDefs);
  const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
  const rendered = body.replace(re, (_, raw: string) => {
    const key = raw.trim();
    const fieldDef = byName.get(key);
    const rawVal = values[key];
    let effective: string | null = null;
    if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "") {
      effective = String(rawVal);
    } else if (fieldDef?.default != null && String(fieldDef.default).trim() !== "") {
      effective = String(fieldDef.default);
    }
    if (effective === null || effective === "") {
      missing.push(key);
      return `{{${key}}}`;
    }
    return effective;
  });
  return { rendered_markdown: rendered, missing_placeholders: [...new Set(missing)] };
}

export function parseFieldsJson(json: string | null): TemplateFieldDef[] {
  if (!json?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((row): row is TemplateFieldDef => row && typeof row === "object" && typeof (row as TemplateFieldDef).name === "string")
      .map((row) => ({
        name: row.name,
        label: typeof row.label === "string" ? row.label : humanizeFieldName(row.name),
        default: row.default ?? null
      }));
  } catch {
    return [];
  }
}

export function assertSourceItemBelongsToCase(db: Database.Database, sourceItemId: string, caseId: string): boolean {
  const row = db
    .prepare(`SELECT id FROM source_items WHERE id = ? AND case_id = ? LIMIT 1`)
    .get(sourceItemId, caseId) as { id: string } | undefined;
  return !!row;
}

export function validateValuesPayload(values: Record<string, string>): { ok: true } | { ok: false; error: string } {
  let approx = 2;
  for (const [k, v] of Object.entries(values)) {
    if (k.length > 200) {
      return { ok: false, error: "placeholder key too long" };
    }
    if (v.length > MAX_SINGLE_PLACEHOLDER_VALUE) {
      return { ok: false, error: `value for "${k}" exceeds limit` };
    }
    approx += k.length + v.length;
  }
  if (approx > MAX_VALUES_JSON_BYTES) {
    return { ok: false, error: "values payload too large" };
  }
  return { ok: true };
}

export function listUserDocumentTemplates(db: Database.Database, caseId: string): UserDocumentTemplateRow[] {
  return db
    .prepare(
      `
        SELECT id, case_id, name, description, body_markdown, fields_json, ai_hints, created_at, updated_at
        FROM user_document_templates
        WHERE case_id = ?
        ORDER BY updated_at DESC, name ASC
      `
    )
    .all(caseId) as UserDocumentTemplateRow[];
}

export function getUserDocumentTemplate(db: Database.Database, templateId: string, caseId: string) {
  return db
    .prepare(
      `
        SELECT id, case_id, name, description, body_markdown, fields_json, ai_hints, created_at, updated_at
        FROM user_document_templates
        WHERE id = ? AND case_id = ?
        LIMIT 1
      `
    )
    .get(templateId, caseId) as UserDocumentTemplateRow | undefined;
}

export function createUserDocumentTemplate(
  db: Database.Database,
  input: {
    caseId: string;
    name: string;
    description?: string | null;
    body_markdown: string;
    fields?: TemplateFieldDef[] | null;
    ai_hints?: string | null;
  }
) {
  return db.transaction(() => {
    const id = randomUUID();
    const inferred = inferFieldsFromBody(input.body_markdown);
    const fields = mergeFieldDefs(inferred, input.fields ?? undefined);
    const name = input.name.trim() || "Untitled template";
    db.prepare(
      `
      INSERT INTO user_document_templates
        (id, case_id, name, description, body_markdown, fields_json, ai_hints)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      input.caseId,
      name,
      input.description?.trim() || null,
      input.body_markdown,
      JSON.stringify(fields),
      input.ai_hints?.trim() || null
    );
    return getUserDocumentTemplate(db, id, input.caseId) ?? null;
  })();
}

export function updateUserDocumentTemplate(
  db: Database.Database,
  input: {
    templateId: string;
    caseId: string;
    name?: string | null;
    description?: string | null;
    body_markdown?: string | null;
    fields?: TemplateFieldDef[] | null;
    ai_hints?: string | null;
  }
) {
  return db.transaction(() => {
    const existing = getUserDocumentTemplate(db, input.templateId, input.caseId);
    if (!existing) {
      return null;
    }
    const body = input.body_markdown ?? existing.body_markdown;
    const inferred = inferFieldsFromBody(body);
    const fields =
      input.fields !== undefined && input.fields !== null
        ? mergeFieldDefs(inferred, input.fields)
        : mergeFieldDefs(inferred, parseFieldsJson(existing.fields_json));

    const name = input.name !== undefined && input.name !== null ? input.name.trim() || "Untitled template" : existing.name;
    const description = input.description !== undefined ? input.description?.trim() || null : existing.description;
    const ai_hints = input.ai_hints !== undefined ? input.ai_hints?.trim() || null : existing.ai_hints;

    db.prepare(
      `
      UPDATE user_document_templates
      SET name = ?,
          description = ?,
          body_markdown = ?,
          fields_json = ?,
          ai_hints = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND case_id = ?
    `
    ).run(name, description, body, JSON.stringify(fields), ai_hints, input.templateId, input.caseId);

    return getUserDocumentTemplate(db, input.templateId, input.caseId) ?? null;
  })();
}

export function deleteUserDocumentTemplate(db: Database.Database, templateId: string, caseId: string) {
  const r = db.prepare(`DELETE FROM user_document_templates WHERE id = ? AND case_id = ?`).run(templateId, caseId);
  return r.changes > 0;
}

export function saveTemplateFill(
  db: Database.Database,
  input: {
    templateId: string;
    caseId: string;
    values: Record<string, string>;
    rendered_markdown: string;
    source_item_id?: string | null;
    status?: string;
  }
) {
  const template = getUserDocumentTemplate(db, input.templateId, input.caseId);
  if (!template) {
    return { ok: false as const, error: "template not found" };
  }
  if (template.case_id !== input.caseId) {
    return { ok: false as const, error: "case mismatch" };
  }
  if (input.source_item_id && !assertSourceItemBelongsToCase(db, input.source_item_id, template.case_id)) {
    return { ok: false as const, error: "source_item_id does not belong to this case" };
  }
  const id = randomUUID();
  const caseId = template.case_id;
  db.prepare(
    `
      INSERT INTO user_document_template_fills
        (id, template_id, case_id, values_json, rendered_markdown, source_item_id, status)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.templateId,
    caseId,
    JSON.stringify(input.values),
    input.rendered_markdown,
    input.source_item_id ?? null,
    input.status?.trim() || "draft"
  );
  return {
    ok: true as const,
    row: db
      .prepare(
        `
        SELECT id, template_id, case_id, values_json, rendered_markdown, source_item_id, status, created_at, updated_at
        FROM user_document_template_fills
        WHERE id = ?
      `
      )
      .get(id) as UserDocumentTemplateFillRow
  };
}

export function getTemplateFill(db: Database.Database, fillId: string, caseId: string) {
  return db
    .prepare(
      `
        SELECT id, template_id, case_id, values_json, rendered_markdown, source_item_id, status, created_at, updated_at
        FROM user_document_template_fills
        WHERE id = ? AND case_id = ?
        LIMIT 1
      `
    )
    .get(fillId, caseId) as UserDocumentTemplateFillRow | undefined;
}

export function updateTemplateFill(
  db: Database.Database,
  input: {
    fillId: string;
    caseId: string;
    values?: Record<string, string> | null;
    rendered_markdown?: string | null;
    status?: string | null;
  }
) {
  const existing = getTemplateFill(db, input.fillId, input.caseId);
  if (!existing) {
    return null;
  }
  let values: Record<string, string>;
  if (input.values !== undefined && input.values !== null) {
    values = input.values;
  } else {
    try {
      values = JSON.parse(existing.values_json) as Record<string, string>;
    } catch {
      values = {};
    }
  }
  const rendered =
    input.rendered_markdown !== undefined && input.rendered_markdown !== null
      ? input.rendered_markdown
      : existing.rendered_markdown;
  const status = input.status !== undefined && input.status !== null ? input.status.trim() : existing.status;

  db.prepare(
    `
      UPDATE user_document_template_fills
      SET values_json = ?,
          rendered_markdown = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND case_id = ?
    `
  ).run(JSON.stringify(values), rendered, status, input.fillId, input.caseId);

  return getTemplateFill(db, input.fillId, input.caseId) ?? null;
}

export function deleteTemplateFill(db: Database.Database, fillId: string, caseId: string) {
  const r = db.prepare(`DELETE FROM user_document_template_fills WHERE id = ? AND case_id = ?`).run(fillId, caseId);
  return r.changes > 0;
}

export function listTemplateFills(db: Database.Database, caseId: string, templateId?: string) {
  if (templateId) {
    return db
      .prepare(
        `
          SELECT id, template_id, case_id, values_json, rendered_markdown, source_item_id, status, created_at, updated_at
          FROM user_document_template_fills
          WHERE case_id = ? AND template_id = ?
          ORDER BY updated_at DESC, created_at DESC
        `
      )
      .all(caseId, templateId) as UserDocumentTemplateFillRow[];
  }
  return db
    .prepare(
      `
        SELECT id, template_id, case_id, values_json, rendered_markdown, source_item_id, status, created_at, updated_at
        FROM user_document_template_fills
        WHERE case_id = ?
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 100
      `
    )
    .all(caseId) as UserDocumentTemplateFillRow[];
}

export function serializeUserDocumentTemplate(row: UserDocumentTemplateRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    name: row.name,
    description: row.description,
    body_markdown: row.body_markdown,
    fields: parseFieldsJson(row.fields_json),
    ai_hints: row.ai_hints,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function serializeUserDocumentFill(row: UserDocumentTemplateFillRow) {
  let values: Record<string, string> = {};
  try {
    values = JSON.parse(row.values_json) as Record<string, string>;
  } catch {
    values = {};
  }
  return {
    id: row.id,
    template_id: row.template_id,
    case_id: row.case_id,
    values,
    rendered_markdown: row.rendered_markdown,
    source_item_id: row.source_item_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function buildFieldsForRender(template: UserDocumentTemplateRow, bodyOverride: string): TemplateFieldDef[] {
  const inferred = inferFieldsFromBody(bodyOverride);
  const stored = parseFieldsJson(template.fields_json);
  return mergeFieldDefs(inferred, stored);
}
