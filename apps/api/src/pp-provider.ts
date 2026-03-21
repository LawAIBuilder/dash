import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readPortEnv } from "./env.js";

const DEFAULT_PP_API_BASE_URL = "https://app.practicepanther.com";
const PP_AUTHORIZE_PATH = "/oauth/authorize";
const PP_TOKEN_PATH = "/oauth/token";
const SOURCE_CONNECTION_SECRET_ENV = "WC_SOURCE_CONNECTION_SECRET";

export const PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE =
  "PracticePanther OAuth and production sync require PP_CLIENT_ID, PP_CLIENT_SECRET, and a registered redirect URI.";

export interface PracticePantherEnvConfig {
  apiBaseUrl: string;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
}

export function readPracticePantherConfig(env: Record<string, string | undefined> = process.env): PracticePantherEnvConfig {
  const publicDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim() || env.RAILWAY_STATIC_URL?.trim() || null;
  const localPort = readPortEnv(4000, env);
  const fallbackRedirectUri = publicDomain
    ? `https://${publicDomain}/api/connectors/practicepanther/callback`
    : `http://127.0.0.1:${localPort}/api/connectors/practicepanther/callback`;
  return {
    apiBaseUrl: env.PP_API_BASE_URL?.trim() || DEFAULT_PP_API_BASE_URL,
    clientId: env.PP_CLIENT_ID?.trim() ?? null,
    clientSecret: env.PP_CLIENT_SECRET?.trim() ?? null,
    redirectUri: env.PP_REDIRECT_URI?.trim() || fallbackRedirectUri
  };
}

export function isPracticePantherProductionSyncConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const c = readPracticePantherConfig(env);
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

export function isPracticePantherOAuthReady(env: Record<string, string | undefined> = process.env): boolean {
  return isPracticePantherProductionSyncConfigured(env);
}

export interface PracticePantherOAuthTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

export interface PracticePantherConnectionMetadata {
  oauth?: {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_at: string;
  };
  oauth_encrypted?: {
    v: 1;
    alg: "aes-256-gcm";
    iv: string;
    tag: string;
    ciphertext: string;
  };
  user?: {
    id?: string | null;
    display_name?: string | null;
    email?: string | null;
  };
  return_to?: string | null;
  linked_matter?: {
    id?: string | null;
    display_name?: string | null;
  };
}

export interface PracticePantherMatterSummary {
  id: string;
  name: string | null;
  display_name: string | null;
  number?: number | null;
  status?: string | null;
  account_ref?: {
    id?: string | null;
    display_name?: string | null;
  } | null;
  custom_field_values?: unknown[];
  open_date?: string | null;
  close_date?: string | null;
  statute_of_limitation_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

function nowIso() {
  return new Date().toISOString();
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSourceConnectionSecret() {
  const raw = process.env[SOURCE_CONNECTION_SECRET_ENV]?.trim();
  if (!raw) {
    return null;
  }
  return createHash("sha256").update(raw).digest();
}

function encryptMetadataValue(value: unknown) {
  const key = readSourceConnectionSecret();
  if (!key) {
    return null;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1 as const,
    alg: "aes-256-gcm" as const,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptMetadataValue<T>(
  value:
    | {
        v: 1;
        alg: "aes-256-gcm";
        iv: string;
        tag: string;
        ciphertext: string;
      }
    | undefined
): T | null {
  if (!value) {
    return null;
  }
  const key = readSourceConnectionSecret();
  if (!key) {
    return null;
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(value.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

export function parsePracticePantherConnectionMetadata(raw: string | null | undefined): PracticePantherConnectionMetadata {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    const metadata = { ...(parsed as PracticePantherConnectionMetadata) };
    if (!metadata.oauth && metadata.oauth_encrypted && isRecord(metadata.oauth_encrypted)) {
      const decrypted = decryptMetadataValue<NonNullable<PracticePantherConnectionMetadata["oauth"]>>(
        metadata.oauth_encrypted
      );
      if (decrypted) {
        metadata.oauth = decrypted;
      }
    }
    return metadata;
  } catch {
    return {};
  }
}

export function serializePracticePantherConnectionMetadata(
  metadata: PracticePantherConnectionMetadata
): string {
  const next: PracticePantherConnectionMetadata = { ...metadata };
  if (next.oauth) {
    const encrypted = encryptMetadataValue(next.oauth);
    if (encrypted) {
      delete next.oauth;
      next.oauth_encrypted = encrypted;
    }
  }
  return JSON.stringify(next);
}

export function mergePracticePantherConnectionMetadata(
  currentRaw: string | null | undefined,
  patch: Partial<PracticePantherConnectionMetadata>
): PracticePantherConnectionMetadata {
  const current = parsePracticePantherConnectionMetadata(currentRaw);
  return {
    ...current,
    ...patch,
    oauth: {
      ...(current.oauth ?? {}),
      ...(patch.oauth ?? {})
    } as PracticePantherConnectionMetadata["oauth"],
    user: {
      ...(current.user ?? {}),
      ...(patch.user ?? {})
    },
    linked_matter: {
      ...(current.linked_matter ?? {}),
      ...(patch.linked_matter ?? {})
    }
  };
}

export function buildPracticePantherAuthorizationUrl(
  config: PracticePantherEnvConfig,
  state: string
): string {
  if (!config.clientId || !config.redirectUri) {
    throw new Error("PracticePanther OAuth is not configured");
  }
  const url = new URL(joinUrl(config.apiBaseUrl, PP_AUTHORIZE_PATH));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) as T & { error?: string; error_description?: string } : ({} as T & {
    error?: string;
    error_description?: string;
  });
  if (!response.ok) {
    const message =
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.error === "string" && payload.error) ||
      `PracticePanther request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

async function fetchPracticePantherJson<T>(
  config: PracticePantherEnvConfig,
  path: string,
  accessToken: string,
  searchParams?: Record<string, string | undefined | null>
): Promise<T> {
  const url = new URL(joinUrl(config.apiBaseUrl, path));
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string" && value.length > 0) {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  return readJsonResponse<T>(response);
}

export async function exchangePracticePantherAuthorizationCode(
  config: PracticePantherEnvConfig,
  code: string
): Promise<PracticePantherOAuthTokens> {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error("PracticePanther OAuth is not configured");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri
  });
  const response = await fetch(joinUrl(config.apiBaseUrl, PP_TOKEN_PATH), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  return readJsonResponse<PracticePantherOAuthTokens>(response);
}

export async function refreshPracticePantherAccessToken(
  config: PracticePantherEnvConfig,
  refreshToken: string
): Promise<PracticePantherOAuthTokens> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("PracticePanther OAuth is not configured");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret
  });
  const response = await fetch(joinUrl(config.apiBaseUrl, PP_TOKEN_PATH), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  return readJsonResponse<PracticePantherOAuthTokens>(response);
}

export function tokensToMetadata(tokens: PracticePantherOAuthTokens): PracticePantherConnectionMetadata["oauth"] {
  const expiresAt = new Date(Date.now() + Math.max(0, tokens.expires_in - 300) * 1000).toISOString();
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: expiresAt
  };
}

export async function fetchPracticePantherCurrentUser(
  config: PracticePantherEnvConfig,
  accessToken: string
): Promise<Record<string, unknown>> {
  return fetchPracticePantherJson<Record<string, unknown>>(config, "/api/v2/users/me", accessToken);
}

export async function fetchPracticePantherMatters(
  config: PracticePantherEnvConfig,
  accessToken: string,
  input?: { searchText?: string | null; updatedSince?: string | null; status?: string | null }
): Promise<PracticePantherMatterSummary[]> {
  return fetchPracticePantherJson<PracticePantherMatterSummary[]>(config, "/api/v2/matters", accessToken, {
    search_text: input?.searchText ?? undefined,
    updated_since: input?.updatedSince ?? undefined,
    status: input?.status ?? undefined
  });
}

export async function fetchPracticePantherMatterById(
  config: PracticePantherEnvConfig,
  accessToken: string,
  matterId: string
): Promise<PracticePantherMatterSummary> {
  return fetchPracticePantherJson<PracticePantherMatterSummary>(
    config,
    `/api/v2/matters/${encodeURIComponent(matterId)}`,
    accessToken
  );
}

export async function fetchPracticePantherAccountById(
  config: PracticePantherEnvConfig,
  accessToken: string,
  accountId: string
): Promise<Record<string, unknown>> {
  return fetchPracticePantherJson<Record<string, unknown>>(
    config,
    `/api/v2/accounts/${encodeURIComponent(accountId)}`,
    accessToken
  );
}

export async function fetchPracticePantherContacts(
  config: PracticePantherEnvConfig,
  accessToken: string,
  accountId: string
): Promise<Array<Record<string, unknown>>> {
  return fetchPracticePantherJson<Array<Record<string, unknown>>>(config, "/api/v2/contacts", accessToken, {
    account_id: accountId
  });
}

export async function fetchPracticePantherNotes(
  config: PracticePantherEnvConfig,
  accessToken: string,
  matterId: string,
  updatedSince?: string | null
): Promise<Array<Record<string, unknown>>> {
  return fetchPracticePantherJson<Array<Record<string, unknown>>>(config, "/api/v2/notes", accessToken, {
    matter_id: matterId,
    updated_since: updatedSince ?? undefined
  });
}

export async function fetchPracticePantherTasks(
  config: PracticePantherEnvConfig,
  accessToken: string,
  matterId: string,
  updatedSince?: string | null
): Promise<Array<Record<string, unknown>>> {
  return fetchPracticePantherJson<Array<Record<string, unknown>>>(config, "/api/v2/tasks", accessToken, {
    matter_id: matterId,
    updated_since: updatedSince ?? undefined
  });
}

export async function fetchPracticePantherEvents(
  config: PracticePantherEnvConfig,
  accessToken: string,
  matterId: string,
  updatedSince?: string | null
): Promise<Array<Record<string, unknown>>> {
  return fetchPracticePantherJson<Array<Record<string, unknown>>>(config, "/api/v2/events", accessToken, {
    matter_id: matterId,
    updated_since: updatedSince ?? undefined
  });
}

export async function fetchPracticePantherEmails(
  config: PracticePantherEnvConfig,
  accessToken: string,
  matterId: string,
  updatedSince?: string | null
): Promise<Array<Record<string, unknown>>> {
  return fetchPracticePantherJson<Array<Record<string, unknown>>>(config, "/api/v2/emails", accessToken, {
    matter_id: matterId,
    updated_since: updatedSince ?? undefined
  });
}

export async function fetchPracticePantherCallLogs(
  config: PracticePantherEnvConfig,
  accessToken: string,
  matterId: string,
  updatedSince?: string | null
): Promise<Array<Record<string, unknown>>> {
  return fetchPracticePantherJson<Array<Record<string, unknown>>>(config, "/api/v2/calllogs", accessToken, {
    matter_id: matterId,
    updated_since: updatedSince ?? undefined
  });
}

export async function fetchPracticePantherRelationships(
  config: PracticePantherEnvConfig,
  accessToken: string,
  matterId: string,
  updatedSince?: string | null
): Promise<Array<Record<string, unknown>>> {
  return fetchPracticePantherJson<Array<Record<string, unknown>>>(config, "/api/v2/relationships", accessToken, {
    matter_id: matterId,
    updated_since: updatedSince ?? undefined
  });
}

export function extractPracticePantherCustomFields(
  scope: string,
  rawEntity: Record<string, unknown>
): Array<{
  pp_field_id: string;
  field_key: string;
  label: string;
  entity_scope?: string;
  field_type?: string | null;
  options_json?: unknown;
  value?: unknown;
  normalized_text?: string | null;
  normalized_number?: number | null;
  normalized_date?: string | null;
}> {
  const rows = Array.isArray(rawEntity.custom_field_values) ? rawEntity.custom_field_values : [];
  return rows
    .map((row) => {
      if (!isRecord(row) || !isRecord(row.custom_field_ref)) {
        return null;
      }
      const ref = row.custom_field_ref;
      const ppFieldId = typeof ref.id === "string" ? ref.id : null;
      const label = typeof ref.label === "string" ? ref.label : null;
      const fieldType = typeof ref.value_type === "string" ? ref.value_type : null;
      if (!ppFieldId || !label) {
        return null;
      }

      const valueString = typeof row.value_string === "string" ? row.value_string : null;
      const valueNumber = typeof row.value_number === "number" ? row.value_number : null;
      const valueDate = typeof row.value_date_time === "string" ? row.value_date_time : null;
      const valueBoolean = typeof row.value_boolean === "boolean" ? row.value_boolean : null;
      const valueContact = isRecord(row.contact_ref) ? row.contact_ref : null;

      let value: unknown = valueString;
      if (valueNumber !== null) value = valueNumber;
      else if (valueDate !== null) value = valueDate;
      else if (valueBoolean !== null) value = valueBoolean;
      else if (valueContact) value = valueContact;

      return {
        pp_field_id: ppFieldId,
        field_key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
        label,
        entity_scope: scope,
        field_type: fieldType,
        options_json: typeof ref.dropdown_list_values === "string" ? ref.dropdown_list_values.split(",").map((v) => v.trim()).filter(Boolean) : null,
        value,
        normalized_text: valueString,
        normalized_number: valueNumber,
        normalized_date: valueDate
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
}

export function buildPracticePantherMatterPatch(rawMatter: Record<string, unknown>) {
  const displayName =
    typeof rawMatter.display_name === "string"
      ? rawMatter.display_name
      : typeof rawMatter.name === "string"
        ? rawMatter.name
        : null;
  const ppMatterId = typeof rawMatter.id === "string" ? rawMatter.id : null;

  const customFields = extractPracticePantherCustomFields("matter", rawMatter);
  const customFieldsByLabel = new Map(customFields.map((f) => [f.label.toLowerCase(), f]));

  const hearingDateField =
    customFieldsByLabel.get("hearing date") ??
    customFieldsByLabel.get("trial date") ??
    customFieldsByLabel.get("conference date");
  const hearingDate = hearingDateField?.normalized_date ?? null;

  const employerField =
    customFieldsByLabel.get("employer") ??
    customFieldsByLabel.get("employer name") ??
    customFieldsByLabel.get("employer1");
  const employerName = employerField?.normalized_text ?? null;

  const insurerField =
    customFieldsByLabel.get("insurer") ??
    customFieldsByLabel.get("insurer name") ??
    customFieldsByLabel.get("insurance carrier") ??
    customFieldsByLabel.get("carrier");
  const insurerName = insurerField?.normalized_text ?? null;

  const accountRef = rawMatter.account_ref;
  const employeeName =
    accountRef && typeof accountRef === "object" && accountRef !== null
      ? (typeof (accountRef as Record<string, unknown>).display_name === "string"
          ? (accountRef as Record<string, unknown>).display_name as string
          : null)
      : null;

  return {
    name: displayName ?? undefined,
    ppMatterId: ppMatterId ?? undefined,
    hearingDate: hearingDate ?? undefined,
    employeeName: employeeName ?? undefined,
    employerName: employerName ?? undefined,
    insurerName: insurerName ?? undefined
  };
}

export function buildPracticePantherSyncCursorValue() {
  return nowIso();
}
