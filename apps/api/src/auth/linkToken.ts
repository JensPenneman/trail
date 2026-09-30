import { HttpError } from "../http/httpError";

export const linkInvalid = (): HttpError =>
  new HttpError(404, "link_invalid", "This link is invalid, was already used or has expired.");

const tokenPattern = /^[A-Za-z0-9_-]{16,128}$/;

/** A link/invite token from a URL path; malformed tokens are simply unknown links. */
export function requireLinkToken(value: string): string {
  if (!tokenPattern.test(value)) throw linkInvalid();
  return value;
}
