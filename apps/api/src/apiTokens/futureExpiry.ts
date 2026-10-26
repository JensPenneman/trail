import { HttpError } from "../http/httpError";

/** The requested expiry as a date; one that is not in the future is a validation error. */
export function futureExpiry(expiresAt: string | null, now: number = Date.now()): Date | null {
  if (expiresAt === null) return null;
  const at = new Date(expiresAt);
  if (at.getTime() <= now) {
    throw new HttpError(
      400,
      "validation_failed",
      "Invalid request — expiresAt: Choose a time in the future",
      { expiresAt: ["Choose a time in the future"] },
    );
  }
  return at;
}
