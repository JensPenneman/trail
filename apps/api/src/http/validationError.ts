import type { z } from "zod";
import { HttpError } from "./httpError";

const pathOf = (issue: z.core.$ZodIssue): string => issue.path.map(String).join(".");

/** 400 `validation_failed` listing each offending field (dot-joined path → messages). */
export function validationError(error: z.ZodError): HttpError {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = pathOf(issue);
    if (path === "") continue;
    fields[path] = [...(fields[path] ?? []), issue.message];
  }
  const summary = error.issues
    .slice(0, 3)
    .map((issue) => (pathOf(issue) === "" ? issue.message : `${pathOf(issue)}: ${issue.message}`))
    .join("; ");
  return new HttpError(
    400,
    "validation_failed",
    `Invalid request — ${summary}`,
    Object.keys(fields).length > 0 ? fields : undefined,
  );
}
