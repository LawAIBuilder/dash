import { createHash } from "node:crypto";

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeOpaqueId(value: string): boolean {
  return SAFE_ID_RE.test(value);
}

export function toSafeFilesystemSegment(value: string, fallbackPrefix = "item"): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[-._]+/, "")
    .slice(0, 120);

  if (normalized) {
    return normalized;
  }

  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${fallbackPrefix}-${digest}`;
}
