export type FixedWindowRateLimitOptions = {
  max: number;
  windowMs: number;
  now?: () => number;
};

export type FixedWindowRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type WindowState = {
  count: number;
  resetAtMs: number;
};

export function createFixedWindowRateLimiter(options: FixedWindowRateLimitOptions) {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, WindowState>();

  return {
    check(key: string): FixedWindowRateLimitResult {
      const currentMs = now();
      const existing = windows.get(key);
      if (!existing || currentMs >= existing.resetAtMs) {
        const nextState: WindowState = {
          count: 1,
          resetAtMs: currentMs + options.windowMs
        };
        windows.set(key, nextState);
        return {
          allowed: true,
          limit: options.max,
          remaining: Math.max(0, options.max - nextState.count),
          retryAfterSeconds: 0
        };
      }

      if (existing.count >= options.max) {
        return {
          allowed: false,
          limit: options.max,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - currentMs) / 1000))
        };
      }

      existing.count += 1;
      windows.set(key, existing);
      return {
        allowed: true,
        limit: options.max,
        remaining: Math.max(0, options.max - existing.count),
        retryAfterSeconds: 0
      };
    },

    clear() {
      windows.clear();
    }
  };
}
