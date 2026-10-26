import { BlockList, isIPv6 } from "node:net";

/**
 * Whether a client address (see `clientAddress`) lies in one of a token's
 * networks (CIDR text as PostgreSQL writes `cidr`: `192.168.1.0/24`,
 * `2001:db8::/32`). An unknown address is never allowed. Only networks of the
 * address's own family count: `BlockList` alone would let every IPv4 client
 * into an IPv6 network that covers `::ffff:0:0/96`, such as `::/0`.
 */
export function addressAllowed(address: string | null, networks: readonly string[]): boolean {
  if (address === null) return false;
  const family = isIPv6(address) ? "ipv6" : "ipv4";
  const list = new BlockList();
  for (const network of networks) {
    const [base = "", prefix = ""] = network.split("/");
    if ((isIPv6(base) ? "ipv6" : "ipv4") !== family) continue;
    list.addSubnet(base, Number(prefix || (family === "ipv6" ? 128 : 32)), family);
  }
  return list.check(address, family);
}
