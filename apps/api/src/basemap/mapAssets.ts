import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  /** The font stacks there are glyphs for. */
  fonts: ReadonlySet<string>;
  /**
   * The glyph file of a font stack and range as a URL names them, or null. The
   * answer is a path listed when the assets were read, found by looking the
   * names up: no part of a request is ever joined into a path.
   */
  fontFile(stack: string, file: string): string | null;
  /** The sprite file a URL names (`ofm.json` …), likewise. */
  spriteFile(file: string): string | null;
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
  // What there is, listed once: the registry the router looks requests up in.
  const fontFiles = new Map<string, string>();
  for (const stack of parsed.fonts) {
    let names: string[];
    try {
      names = readdirSync(join(dir, "fonts", stack));
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".pbf") && isGlyphRange(name.slice(0, -4))) {
        fontFiles.set(`${stack}/${name}`, join(dir, "fonts", stack, name));
      }
    }
  }
  const spriteMap = new Map<string, string>();
  for (const name of spriteFiles) {
    const path = join(dir, "sprites", name);
    if (existsSync(path)) spriteMap.set(name, path);
  }
  return {
    hash: parsed.hash,
    fonts: new Set(parsed.fonts),
    fontFile: (stack, file) => fontFiles.get(`${stack}/${file}`) ?? null,
    spriteFile: (file) => spriteMap.get(file) ?? null,
  };
}

/** `0-255`, `256-511` … `65280-65535`: a range of 256 code points as MapLibre names it. */
export function isGlyphRange(name: string): boolean {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(name);
  if (match === null) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start % 256 === 0 && end === start + 255 && end <= 65_535 && match[1] === String(start);
}
