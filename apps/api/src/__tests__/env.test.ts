import { describe, expect, it, vi } from "vitest";
import {
  clampPositiveIntegerInput,
  readBooleanEnv,
  readDevRoutesEnabled,
  readPortEnv,
  readPositiveIntegerEnv
} from "../env.js";

describe("env helpers", () => {
  it("falls back when positive integer env values are invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = { WC_UPLOAD_MAX_BYTES: "not-a-number" };

    expect(readPositiveIntegerEnv("WC_UPLOAD_MAX_BYTES", 1024, { min: 1 }, env)).toBe(1024);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it("falls back when env values are outside the allowed range", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = { WC_UPLOAD_MAX_BYTES: "0" };

    expect(readPositiveIntegerEnv("WC_UPLOAD_MAX_BYTES", 2048, { min: 1 }, env)).toBe(2048);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it("respects valid port and clamps input values", () => {
    expect(readPortEnv(4000, { PORT: "4011" })).toBe(4011);
    expect(clampPositiveIntegerInput("200001", 50_000, { min: 1, max: 200_000 })).toBe(200_000);
    expect(clampPositiveIntegerInput(undefined, 50_000, { min: 1, max: 200_000 })).toBe(50_000);
  });

  it("parses boolean env values and falls back on invalid input", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readBooleanEnv("WC_TRUST_PROXY", false, undefined, { WC_TRUST_PROXY: "true" })).toBe(true);
    expect(readBooleanEnv("WC_TRUST_PROXY", true, undefined, { WC_TRUST_PROXY: "0" })).toBe(false);
    expect(readBooleanEnv("WC_TRUST_PROXY", true, undefined, { WC_TRUST_PROXY: "invalid" })).toBe(true);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it("disables dev routes by default for staging-like environments", () => {
    expect(readDevRoutesEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(readDevRoutesEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(readDevRoutesEnabled({ NODE_ENV: "" })).toBe(true);
    expect(readDevRoutesEnabled({ NODE_ENV: "staging" })).toBe(false);
    expect(readDevRoutesEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(readDevRoutesEnabled({ NODE_ENV: "staging", WC_ENABLE_DEV_ROUTES: "1" })).toBe(true);
    expect(readDevRoutesEnabled({ NODE_ENV: "production", WC_ENABLE_DEV_ROUTES: "true" })).toBe(true);
    expect(readDevRoutesEnabled({ NODE_ENV: "development", WC_ENABLE_DEV_ROUTES: "0" })).toBe(false);
  });
});
