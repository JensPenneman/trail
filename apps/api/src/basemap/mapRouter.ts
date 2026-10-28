import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import express, { type NextFunction, type Response, type Router } from "express";
import type { Logger } from "pino";
import { etagMatches } from "../cache/etagMatches";
import { ipRateLimit } from "../http/ipRateLimit";
import type { Basemap } from "./basemap";
import { maxTileBytes } from "./basemapArchive";
import { bundleTile } from "./basemapBundle";
import type { StyleName } from "./basemapStyles";
import { isGlyphRange, spriteFiles } from "./mapAssets";

/** The schema's highest zoom (§3.1): MapLibre asks for nothing beyond the source's `maxzoom`. */
const maxZoom = 14;
/** A year: the bundle's id or the assets' hash is in the path, so an answer never changes. */
const immutable = "public, max-age=31536000, immutable";

/** A whole number as it is written once: `7`, never `07` or `7.0`, so every tile has one URL. */
const wholeNumber = (text: string, digits: number): number | null =>
  new RegExp(`^(0|[1-9][0-9]{0,${digits - 1}})$`).test(text) ? Number(text) : null;

/** `z`, `x` and `y.pbf` of a tile URL, inside the zoom's grid, or null. */
export function tileCoordinates(
  zText: string,
  xText: string,
  yFile: string,
): { z: number; x: number; y: number } | null {
  const z = wholeNumber(zText, 2);
  const x = wholeNumber(xText, 5);
  const y = yFile.endsWith(".pbf") ? wholeNumber(yFile.slice(0, -4), 5) : null;
  if (z === null || x === null || y === null || z > maxZoom) return null;
  const size = 2 ** z;
  return x < size && y < size ? { z, x, y } : null;
}

const notFound = (res: Response): void => {
  res.status(404).setHeader("Cache-Control", "no-store");
  res.type("text/plain").send("Not found.");
};

const styleNames: Readonly<Record<string, StyleName>> = {
  "light.json": "light",
  "dark.json": "dark",
};

/** A file of the image's map assets: immutable, as `/assets/*`, and never in parts. */
function sendAsset(res: Response, path: string, type: string, next: NextFunction): void {
  res.type(type);
  res.sendFile(
    path,
    { maxAge: "1y", immutable: true, acceptRanges: false, dotfiles: "deny" },
    (error?: Error & { code?: string; status?: number }) => {
      if (error === undefined || res.headersSent) return;
      if (error.code === "ENOENT" || error.status === 404) notFound(res);
      else next(error);
    },
  );
}

/**
 * `/map/*`, the basemap (docs/design/self-hosted-maps.md §3.3): public, no
 * session, its own per-address limit, mounted before compression (tiles are
 * stored gzipped; glyphs and sprites hardly compress). The styles answer
 * `no-cache` with an ETag, so that a new bundle reaches a map at its next
 * load; tiles, fonts and sprites carry the bundle's id or the assets' hash
 * in the path and are immutable. Every name in a path is checked against
 * what is open or listed — a bundle, a font stack, a sprite file — and only
 * numbers of a tile's grid go further, so no request names a file.
 */
export function mapRouter(input: { basemap: Basemap; logger: Logger; perMinute: number }): Router {
  const { basemap } = input;
  const router = express.Router();
  router.use(
    ipRateLimit({
      limit: input.perMinute,
      windowMs: 60_000,
      logger: input.logger,
      identifier: "map",
    }),
  );

  router.get("/styles/:file", (req, res) => {
    const name = styleNames[req.params.file];
    if (name === undefined) {
      notFound(res);
      return;
    }
    const style = basemap.style(name);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", style.etag);
    if (etagMatches(req.get("if-none-match"), style.etag)) {
      res.status(304).end();
      return;
    }
    res.type("application/json").send(style.body);
  });

  router.get("/tiles/:bundle/:z/:x/:y", async (req, res) => {
    const coordinates = tileCoordinates(req.params.z, req.params.x, req.params.y);
    const bundle = /^[0-9a-f]{16}$/.test(req.params.bundle)
      ? basemap.bundle(req.params.bundle)
      : null;
    if (coordinates === null || bundle === null) {
      notFound(res);
      return;
    }
    const { z, x, y } = coordinates;
    const tile = await bundleTile(bundle, z, x, y);
    res.setHeader("Cache-Control", immutable);
    let etag = `"${bundle.id}"`;
    if (tile === null) {
      res.setHeader("ETag", etag);
      res.status(etagMatches(req.get("if-none-match"), etag) ? 304 : 204).end();
      return;
    }
    let body = tile.data;
    let gzipped = tile.compression === "gzip";
    if (gzipped) {
      res.setHeader("Vary", "Accept-Encoding");
      // A client that takes no gzip gets the tile inflated, under an ETag of its own.
      if (req.acceptsEncodings("gzip") !== "gzip") {
        body = gunzipSync(body, { maxOutputLength: 8 * maxTileBytes });
        gzipped = false;
        etag = `"${bundle.id}-identity"`;
      }
    }
    res.setHeader("ETag", etag);
    if (etagMatches(req.get("if-none-match"), etag)) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", "application/x-protobuf");
    if (gzipped) res.setHeader("Content-Encoding", "gzip");
    res.send(body);
  });

  router.get("/assets/:hash/fonts/:stack/:file", (req, res, next) => {
    const { assets } = basemap;
    const { hash, stack, file } = req.params;
    if (
      assets === null ||
      hash !== assets.hash ||
      !assets.fonts.has(stack) ||
      !file.endsWith(".pbf") ||
      !isGlyphRange(file.slice(0, -4))
    ) {
      notFound(res);
      return;
    }
    sendAsset(res, join(assets.dir, "fonts", stack, file), "application/x-protobuf", next);
  });

  router.get("/assets/:hash/sprites/:file", (req, res, next) => {
    const { assets } = basemap;
    const { hash, file } = req.params;
    const known = (spriteFiles as readonly string[]).includes(file);
    if (assets === null || hash !== assets.hash || !known) {
      notFound(res);
      return;
    }
    const type = file.endsWith(".png") ? "image/png" : "application/json";
    sendAsset(res, join(assets.dir, "sprites", file), type, next);
  });

  router.use((_req, res) => notFound(res));
  return router;
}
