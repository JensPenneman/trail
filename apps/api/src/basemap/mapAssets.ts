import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** The sprite sheet's files, as MapLibre asks for them (`sprite` + `.json`, `.png`, `@2x…`). */
export const spriteFiles = ["ofm.json", "ofm.png", "ofm@2x.json", "ofm@2x.png"] as const;
/** The sheet's name in the styles' `sprite` URL. */
export const spriteName = "ofm";

const assetsSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{16}$/),
  fonts: z
    .array(z.string().regex(/^[A-Za-z0-9 ]{1,64}$/))
    .min(1)
    .max(16),
});

/**
 * The fonts and sprites of the image (docs/design/self-hosted-maps.md §3.2):
 * `scripts/map-assets.mjs` writes them to `<web dist>/map-assets/<hash>/`,
 * `<hash>` from `scripts/map-assets.json`, and `assets.json` beside them last.
 */
export interface MapAssets {
  /** In the URLs: a new set of assets is a new URL, so every file is cached for good. */
  hash: string;
  /** `<web dist>/map-assets/<hash>`. */
  dir: string;
  /** The font stacks there are glyphs for: a request names one of them or nothing. */
  fonts: ReadonlySet<string>;
}

/** The image's map assets, or null when the build has none (`npm run dev` before a build). */
export function readMapAssets(webDistDir: string): MapAssets | null {
  const root = join(webDistDir, "map-assets");
  let parsed: z.infer<typeof assetsSchema>;
  try {
    parsed = assetsSchema.parse(JSON.parse(readFileSync(join(root, "assets.json"), "utf8")));
  } catch {
    return null;
  }
  const dir = join(root, parsed.hash);
  if (!existsSync(dir)) return null;
  return { hash: parsed.hash, dir, fonts: new Set(parsed.fonts) };
}

/** `0-255`, `256-511` … `65280-65535`: a range of 256 code points as MapLibre names it. */
export function isGlyphRange(name: string): boolean {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(name);
  if (match === null) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start % 256 === 0 && end === start + 255 && end <= 65_535 && match[1] === String(start);
}
