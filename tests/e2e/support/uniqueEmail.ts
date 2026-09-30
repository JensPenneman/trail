import { randomUUID } from "node:crypto";
import { allowlistedDomain } from "./serverEnvironment";

/**
 * A new address for every account a test creates, so tests never share a
 * person and can run in parallel — also against a server that keeps its data.
 */
export function uniqueEmail(label: string, domain = allowlistedDomain): string {
  return `${label}-${randomUUID().slice(0, 8)}@${domain}`;
}
