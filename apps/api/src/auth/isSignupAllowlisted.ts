/**
 * Whether an address may create an account without an invite. Entries are
 * exact addresses or `*@domain` (that domain only, not its subdomains).
 */
export function isSignupAllowlisted(email: string, allowlist: readonly string[]): boolean {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = address.slice(at + 1);
  return allowlist.some((entry) => {
    const normalised = entry.trim().toLowerCase();
    return normalised.startsWith("*@") ? normalised.slice(2) === domain : normalised === address;
  });
}
