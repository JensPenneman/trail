import type { ErrorCode } from "@trail/contracts/errors";

/**
 * Failures that never produced a well-formed API answer: the request did not
 * reach the server (`network`) or the answer did not match the contract
 * (`invalid_response`).
 */
type ClientErrorCode = "network" | "invalid_response";

export type ApiErrorCode = ErrorCode | ClientErrorCode;

/** Every failed API call surfaces as this, so screens can branch on `code` instead of parsing text. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Validation messages per request field (dot-joined path). */
  readonly fields: Readonly<Record<string, readonly string[]>>;

  constructor(input: {
    status: number;
    code: ApiErrorCode;
    message: string;
    fields?: Readonly<Record<string, readonly string[]>>;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.status = input.status;
    this.code = input.code;
    this.fields = input.fields ?? {};
  }
}
