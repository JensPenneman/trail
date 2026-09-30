import type { ApiError } from "@trail/contracts/errors";
import type { Response } from "express";
import type { HttpError } from "./httpError";

/** Writes the contract error body `{ error: { code, message, fields? } }`. */
export function sendApiError(res: Response, error: HttpError): void {
  const body: ApiError = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
    },
  };
  res.status(error.status).json(body);
}
