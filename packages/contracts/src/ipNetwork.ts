import { z } from "zod";

/*
 * IPv4 and IPv6 networks in CIDR notation (`192.168.1.0/24`, `2001:db8::/32`,
 * or a single address), as an API token's address allowlist takes them. The
 * parser is deliberately stricter than PostgreSQL's `cidr` input (no
 * abbreviated `10/8`, no leading zeros, no zone ids), so whatever passes here
 * the database accepts too.
 */

interface ParsedNetwork {
  version: 4 | 6;
  /** 4 or 16 bytes. */
  bytes: number[];
  prefix: number;
}

function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

function parseHextets(text: string): number[] | null {
  if (text === "") return [];
  const values: number[] = [];
  for (const part of text.split(":")) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    values.push(Number.parseInt(part, 16));
  }
  return values;
}

function parseIpv6(text: string): number[] | null {
  let groups = text;
  let embedded: number[] = [];
  // A dotted IPv4 tail (`::ffff:192.0.2.1`) stands for the last two groups.
  if (text.includes(".")) {
    const at = text.lastIndexOf(":");
    const v4 = parseIpv4(text.slice(at + 1));
    if (at < 0 || v4 === null) return null;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    embedded = [a * 256 + b, c * 256 + d];
    groups = text.slice(0, at + 1);
    if (!groups.endsWith("::")) groups = groups.slice(0, -1);
  }
  const halves = groups.split("::");
  if (halves.length > 2) return null;
  const head = parseHextets(halves[0] ?? "");
  const tail = halves.length === 2 ? parseHextets(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;
  const given = head.length + tail.length + embedded.length;
  // `::` stands for at least one group of zeros; without it all eight are spelled out.
  if (halves.length === 2 ? given > 7 : given !== 8) return null;
  const hextets = [...head, ...Array<number>(8 - given).fill(0), ...tail, ...embedded];
  return hextets.flatMap((value) => [value >> 8, value & 0xff]);
}

function parseNetwork(text: string): ParsedNetwork | null {
  const [address = "", prefixText, ...rest] = text.split("/");
  if (rest.length > 0) return null;
  const version = address.includes(":") ? 6 : 4;
  const bytes = version === 4 ? parseIpv4(address) : parseIpv6(address);
  if (bytes === null) return null;
  const bits = bytes.length * 8;
  if (prefixText === undefined) return { version, bytes, prefix: bits };
  if (!/^(0|[1-9][0-9]{0,2})$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  return prefix > bits ? null : { version, bytes, prefix };
}

/** The bytes with every bit after `prefix` cleared: the network the address belongs to. */
const networkBytes = (bytes: readonly number[], prefix: number): number[] =>
  bytes.map((byte, index) => {
    const kept = Math.min(Math.max(prefix - index * 8, 0), 8);
    return byte & ((0xff << (8 - kept)) & 0xff);
  });

/** RFC 5952 text: lower case, the longest run of two or more zero groups as `::`. */
function formatIpv6(bytes: readonly number[]): string {
  const groups = Array.from({ length: 8 }, (_, index) =>
    (((bytes[index * 2] ?? 0) << 8) | (bytes[index * 2 + 1] ?? 0)).toString(16),
  );
  let best = { start: -1, length: 0 };
  for (let start = 0; start < 8; start += 1) {
    let length = 0;
    while (start + length < 8 && groups[start + length] === "0") length += 1;
    if (length > best.length) best = { start, length };
  }
  if (best.length < 2) return groups.join(":");
  const left = groups.slice(0, best.start).join(":");
  const right = groups.slice(best.start + best.length).join(":");
  return `${left}::${right}`;
}

const formatNetwork = (network: ParsedNetwork): string =>
  `${network.version === 4 ? network.bytes.join(".") : formatIpv6(network.bytes)}/${network.prefix}`;

/** An IPv4 network written in IPv6 (`::ffff:192.0.2.0/120`), as IPv4 (`192.0.2.0/24`). */
function asIpv4(network: ParsedNetwork): ParsedNetwork | null {
  const { bytes, prefix } = network;
  const mapped =
    network.version === 6 &&
    prefix >= 96 &&
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  return mapped ? { version: 4, bytes: bytes.slice(12), prefix: prefix - 96 } : null;
}

/** Why `text` is not a network an allowlist can hold, or null when it is one. */
export function ipNetworkProblem(text: string): string | null {
  const network = parseNetwork(text);
  if (network === null) {
    return `${text} is not an IP address or a network such as 192.168.1.0/24 or 2001:db8::/32`;
  }
  // IPv4 clients are matched against IPv4 networks only, so these must be written as such.
  const ipv4 = asIpv4(network);
  if (ipv4 !== null) {
    return `${text} is an IPv4 network in IPv6 notation: write ${formatNetwork({ ...ipv4, bytes: networkBytes(ipv4.bytes, ipv4.prefix) })}`;
  }
  const masked = networkBytes(network.bytes, network.prefix);
  if (masked.some((byte, index) => byte !== network.bytes[index])) {
    const suggestion = formatNetwork({ ...network, bytes: masked });
    return `${text} has bits set after the prefix: the network is ${suggestion}`;
  }
  return null;
}

/** One entry of an address allowlist: an IPv4 or IPv6 address, or a network in CIDR notation. */
export const ipNetworkSchema = z
  .string()
  .trim()
  .refine((value) => ipNetworkProblem(value) === null, {
    error: (issue) => ipNetworkProblem(String(issue.input)) ?? "Not an IP network",
  });
