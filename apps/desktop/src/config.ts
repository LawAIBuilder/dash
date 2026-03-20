export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export function buildApiHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init ?? {});
  const key = import.meta.env.VITE_WC_API_KEY as string | undefined;
  if (key && key.trim().length > 0) {
    headers.set("Authorization", `Bearer ${key.trim()}`);
  }
  return headers;
}
