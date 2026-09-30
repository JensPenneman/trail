import { errorCodes } from "./errorChain";

/*
 * Data the database refuses: SQLSTATE class 22 (a number out of range, an
 * invalid character, an impossible date …), not-null and check violations, and
 * 54000 (a value too large for an index). The statement's data is at fault,
 * not the connection — sending the same data again fails again.
 */
const refusesData = (code: string): boolean =>
  code.startsWith("22") || code === "23502" || code === "23514" || code === "54000";

/** The SQLSTATE when an error means "the database refused this data", else null. */
export function refusedDataCode(error: unknown): string | null {
  return errorCodes(error).find(refusesData) ?? null;
}
