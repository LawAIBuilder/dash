import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter } from "../rate-limit.js";

describe("createFixedWindowRateLimiter", () => {
  it("allows requests within the window and blocks once the limit is exceeded", () => {
    let currentMs = 0;
    const limiter = createFixedWindowRateLimiter({
      max: 2,
      windowMs: 1_000,
      now: () => currentMs
    });

    expect(limiter.check("bucket:127.0.0.1")).toMatchObject({
      allowed: true,
      limit: 2,
      remaining: 1
    });
    expect(limiter.check("bucket:127.0.0.1")).toMatchObject({
      allowed: true,
      limit: 2,
      remaining: 0
    });
    expect(limiter.check("bucket:127.0.0.1")).toMatchObject({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 1
    });

    currentMs = 1_001;
    expect(limiter.check("bucket:127.0.0.1")).toMatchObject({
      allowed: true,
      limit: 2,
      remaining: 1
    });
  });
});
