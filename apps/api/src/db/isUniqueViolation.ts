import { errorChain } from "./errorChain";

/** True for a Postgres unique violation (23505), optionally of one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (const item of errorChain(error)) {
    if (typeof item !== "object" || item === null || !("code" in item)) continue;
    if (item.code !== "23505") continue;
    if (constraint === undefined) return true;
    return "constraint" in item && item.constraint === constraint;
  }
  return false;
}
