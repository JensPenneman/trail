import type { ErrorCode } from "@trail/contracts/errors";

/** An error with a status and a contract error code; the error handler turns it into `{ error }`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string[]> | undefined;

  constructor(status: number, code: ErrorCode, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** Unknown and foreign resources look the same: no probing for ids of other people. */
export const notFound = (message = "Not found."): HttpError =>
  new HttpError(404, "not_found", message);
