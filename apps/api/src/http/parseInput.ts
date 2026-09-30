import type { Request } from "express";
import type { z } from "zod";
import { validationError } from "./validationError";

/** Validates the JSON body with a contract schema; failures become 400 `validation_failed`. */
export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.output<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/** Validates the query string with a contract schema; failures become 400 `validation_failed`. */
export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.output<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
