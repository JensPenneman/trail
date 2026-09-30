import { errorChain, errorCodes } from "./errorChain";

/* Network errors and the SQLSTATEs Postgres uses while starting, stopping or
 * refusing connections: the request may succeed if the client retries. */
const unavailableCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "57P01",
  "57P02",
  "57P03",
  "53300",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
]);

const unavailableMessages =
  /connection terminated|timeout exceeded when trying to connect|connection error|cannot use a pool after calling end/i;

/** True when an error means "the database cannot be reached right now" (→ 503, retry later). */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (errorCodes(error).some((code) => unavailableCodes.has(code))) return true;
  for (const item of errorChain(error)) {
    if (item instanceof Error && unavailableMessages.test(item.message)) return true;
  }
  return false;
}
