export interface ApiErrorResponseBody {
  ok: false;
  error: string;
  code: string;
}

function readStatusCode(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode <= 599
  ) {
    return error.statusCode;
  }

  return 500;
}

export function buildApiErrorResponse(
  error: unknown,
  production = process.env.NODE_ENV === "production"
): {
  statusCode: number;
  body: ApiErrorResponseBody;
} {
  const statusCode = readStatusCode(error);
  const isInternal = statusCode >= 500;
  const defaultMessage = isInternal ? "Internal server error" : "Request failed";
  const errorMessage =
    !production || !isInternal
      ? error instanceof Error && error.message.trim()
        ? error.message
        : defaultMessage
      : defaultMessage;

  return {
    statusCode,
    body: {
      ok: false,
      error: errorMessage,
      code: isInternal ? "internal_error" : "request_error"
    }
  };
}
