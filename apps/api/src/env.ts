type IntegerOptions = {
  min?: number;
  max?: number;
  warnLabel?: string | null;
};

type BooleanOptions = {
  warnLabel?: string | null;
};

function parseInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function warnInvalidConfig(label: string, rawValue: unknown, fallback: number) {
  // eslint-disable-next-line no-console
  console.warn(`[config] Invalid ${label}=${String(rawValue)}; using fallback ${fallback}.`);
}

function warnInvalidBooleanConfig(label: string, rawValue: unknown, fallback: boolean) {
  // eslint-disable-next-line no-console
  console.warn(`[config] Invalid ${label}=${String(rawValue)}; using fallback ${String(fallback)}.`);
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

export function readPositiveIntegerEnv(
  name: string,
  fallback: number,
  options?: IntegerOptions,
  env: Record<string, string | undefined> = process.env
): number {
  const min = options?.min ?? 1;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  const rawValue = env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = parseInteger(rawValue);
  if (parsed === null || parsed < min || parsed > max) {
    if (options?.warnLabel !== null) {
      warnInvalidConfig(options?.warnLabel ?? name, rawValue, fallback);
    }
    return fallback;
  }

  return parsed;
}

export function clampPositiveIntegerInput(
  value: unknown,
  fallback: number,
  options?: Omit<IntegerOptions, "warnLabel">
): number {
  const min = options?.min ?? 1;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  const parsed = parseInteger(value);
  if (parsed === null) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function readPortEnv(
  fallback = 4000,
  env: Record<string, string | undefined> = process.env
): number {
  return readPositiveIntegerEnv("PORT", fallback, { min: 1, max: 65_535 }, env);
}

export function readBooleanEnv(
  name: string,
  fallback: boolean,
  options?: BooleanOptions,
  env: Record<string, string | undefined> = process.env
): boolean {
  const rawValue = env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = parseBoolean(rawValue);
  if (parsed === null) {
    if (options?.warnLabel !== null) {
      warnInvalidBooleanConfig(options?.warnLabel ?? name, rawValue, fallback);
    }
    return fallback;
  }

  return parsed;
}

export function readDevRoutesEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.WC_ENABLE_DEV_ROUTES !== undefined) {
    return readBooleanEnv("WC_ENABLE_DEV_ROUTES", false, undefined, env);
  }

  const nodeEnv = env.NODE_ENV?.trim().toLowerCase() ?? "";
  return nodeEnv === "" || nodeEnv === "development" || nodeEnv === "test";
}
