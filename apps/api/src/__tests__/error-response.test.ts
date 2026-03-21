import { describe, expect, it } from "vitest";
import { buildApiErrorResponse } from "../error-response.js";

describe("buildApiErrorResponse", () => {
  it("sanitizes internal errors in production", () => {
    const response = buildApiErrorResponse(new Error("sqlite path leaked"), true);

    expect(response).toEqual({
      statusCode: 500,
      body: {
        ok: false,
        error: "Internal server error",
        code: "internal_error"
      }
    });
  });

  it("preserves internal error detail outside production", () => {
    const response = buildApiErrorResponse(new Error("sqlite path leaked"), false);

    expect(response).toEqual({
      statusCode: 500,
      body: {
        ok: false,
        error: "sqlite path leaked",
        code: "internal_error"
      }
    });
  });

  it("preserves client error detail and status codes", () => {
    const response = buildApiErrorResponse(
      Object.assign(new Error("bad request"), { statusCode: 400 }),
      true
    );

    expect(response).toEqual({
      statusCode: 400,
      body: {
        ok: false,
        error: "bad request",
        code: "request_error"
      }
    });
  });
});
