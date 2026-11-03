import type { TransformStyleFunction } from "maplibre-gl";

/**
 * MapLibre 6 loads a sprite sheet from an absolute URL only, and the server's
 * own styles name theirs by a path (`/map/assets/…/sprites/ofm`, same origin
 * whatever address the dashboard was opened on): resolved here against the
 * page's address before the style is applied. Tiles and glyphs keep their
 * paths, which MapLibre resolves itself; a style from elsewhere passes as it is.
 */
export const absoluteSprite: TransformStyleFunction = (_previous, next) => {
  const { sprite } = next;
  const absolute = (url: string) => new URL(url, window.location.href).href;
  if (typeof sprite === "string") return { ...next, sprite: absolute(sprite) };
  if (Array.isArray(sprite)) {
    return { ...next, sprite: sprite.map((entry) => ({ ...entry, url: absolute(entry.url) })) };
  }
  return next;
};
