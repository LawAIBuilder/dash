export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

function readTruthyFlag(value: string | undefined) {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isLegacyBrowserApiKeyFallbackEnabled() {
  return readTruthyFlag(import.meta.env.VITE_WC_ENABLE_API_KEY_FALLBACK as string | undefined);
}

export function hasBrowserApiKeyAuth() {
  const key = import.meta.env.VITE_WC_API_KEY as string | undefined;
  return isLegacyBrowserApiKeyFallbackEnabled() && Boolean(key && key.trim().length > 0);
}

export function buildApiHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init ?? {});
  const key = import.meta.env.VITE_WC_API_KEY as string | undefined;
  if (isLegacyBrowserApiKeyFallbackEnabled() && key && key.trim().length > 0) {
    headers.set("Authorization", `Bearer ${key.trim()}`);
  }
  return headers;
}
