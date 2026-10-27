import { isIPv4, isIPv6 } from "node:net";
import { clientAddress } from "../apiTokens/clientAddress";

const dottedQuad = /(\d{1,3}(?:\.\d{1,3}){3})$/;

/** The eight 16-bit groups of an address `isIPv6` accepted, `::` and a dotted tail included. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const tail: number[] = [];
  const quad = dottedQuad.exec(text)?.[1];
  if (quad !== undefined) {
    const [a = 0, b = 0, c = 0, d = 0] = quad.split(".").map(Number);
    tail.push(a * 256 + b, c * 256 + d);
    text = text.slice(0, -quad.length);
    // "1:2:3:4:5:6:1.2.3.4" leaves a colon behind, "::1.2.3.4" the "::" itself.
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }
  const groupsOf = (part: string): number[] =>
    part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16));
  const [head = "", rest] = text.split("::");
  const front = groupsOf(head);
  const back = rest === undefined ? [] : groupsOf(rest);
  const missing = 8 - front.length - back.length - tail.length;
  if (rest === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...front,
    ...Array.from({ length: rest === undefined ? 0 : missing }, () => 0),
    ...back,
    ...tail,
  ];
  return groups.length === 8 &&
    groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

/** RFC 5952 text: lower-case groups without leading zeros, the longest zero run as `::`. */
function ipv6Text(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < groups.length; start += 1) {
    let length = 0;
    while (start + length < groups.length && groups[start + length] === 0) length += 1;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart < 0) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

/**
 * The network a client address belongs to, all the data access log keeps of
 * a link visitor's address (docs/architecture.md §8.7): IPv4 as its /24
 * (`81.82.83.0/24`), IPv6 as its /48 (`2001:db8:1234::/48`) — an
 * IPv4-mapped IPv6 address counts as the IPv4 address it carries. Null for
 * anything that is not an address.
 */
export function coarseNetwork(ip: string | null | undefined): string | null {
  const address = clientAddress(ip);
  if (address === null) return null;
  if (isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return `${a}.${b}.${c}.0/24`;
  }
  if (!isIPv6(address)) return null;
  const groups = ipv6Groups(address);
  if (groups === null) return null;
  return `${ipv6Text([...groups.slice(0, 3), 0, 0, 0, 0, 0])}/48`;
}
