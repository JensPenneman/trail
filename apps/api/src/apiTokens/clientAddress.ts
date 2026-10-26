import { isIP } from "node:net";

const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * The client address of a request (`req.ip`, as `trust proxy` settles it) in
 * the form allowlists and `last_used_ip` use: IPv4 as IPv4 even when a dual-stack
 * socket reports it IPv4-mapped (`::ffff:203.0.113.9`), and without the zone a
 * link-local peer comes with (`fe80::1%en0`), which `inet` refuses. Null for
 * anything that is not an address, so it never reaches the database as one.
 */
export function clientAddress(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined) return null;
  const withoutZone = ip.replace(/%[^%]*$/, "");
  const unmapped = mappedIpv4.exec(withoutZone)?.[1] ?? withoutZone;
  return isIP(unmapped) === 0 ? null : unmapped;
}
