import { randomInt } from "node:crypto";

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Lower-case slug of a device name ("Jens’s iPhone 15" → "jenss-iphone-15"), at most `maxLength`. */
export function slugify(name: string, maxLength: number): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "device";
}

/**
 * The default Overland "Device ID": slug of the name plus four random
 * characters, so two phones called "iPhone" still get distinct keys.
 */
export function defaultDeviceKey(name: string): string {
  let suffix = "";
  for (let index = 0; index < 4; index += 1) suffix += alphabet[randomInt(alphabet.length)] ?? "x";
  return `${slugify(name, 35)}-${suffix}`;
}
