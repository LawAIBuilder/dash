/**
 * PracticePanther production sync is deferred until the Box vertical is stable.
 * OAuth token storage and REST calls will live here; for now callers should use
 * `POST /api/connectors/practicepanther/development/hydrate` with entity payloads.
 */
export const PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE =
  "PracticePanther REST + OAuth sync is not configured. Use POST /api/connectors/practicepanther/development/hydrate with entity payloads until PP refresh tokens and API base URL are wired in pp-provider.";

export interface PracticePantherEnvConfig {
  apiBaseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
}

export function readPracticePantherConfig(env: Record<string, string | undefined> = process.env): PracticePantherEnvConfig {
  return {
    apiBaseUrl: env.PP_API_BASE_URL?.trim() ?? null,
    clientId: env.PP_CLIENT_ID?.trim() ?? null,
    clientSecret: env.PP_CLIENT_SECRET?.trim() ?? null,
    redirectUri: env.PP_REDIRECT_URI?.trim() ?? null
  };
}

export function isPracticePantherProductionSyncConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const c = readPracticePantherConfig(env);
  return Boolean(c.apiBaseUrl && c.clientId);
}

export function isPracticePantherOAuthReady(env: Record<string, string | undefined> = process.env): boolean {
  const c = readPracticePantherConfig(env);
  return Boolean(c.apiBaseUrl && c.clientId && c.clientSecret && c.redirectUri);
}

/**
 * Placeholder for future PP REST calls (matters, contacts, custom fields).
 * @throws Error always — implement token storage + fetch next.
 */
export async function fetchPracticePantherMatters(_accessToken: string): Promise<unknown> {
  throw new Error(
    "PracticePanther REST sync is not implemented yet. Wire OAuth code exchange + token persistence, then implement list matters against PP_API_BASE_URL."
  );
}
