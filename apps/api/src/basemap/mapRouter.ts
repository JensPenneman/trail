import { join } from "node:path";
import express, {
  type NextFunction,
  type RequestHandler,
  type Response,
  type Router,
} from "express";
import type { Logger } from "pino";
import { etagMatches } from "../cache/etagMatches";
import { ipRateLimit } from "../http/ipRateLimit";
import { requestOrigin } from "../http/requestOrigin";
import type { Basemap } from "./basemap";
import { ArchiveClosedError } from "./basemapArchive";
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
  res.removeHeader("Vary");
  res.removeHeader("ETag");
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
 * session, its own per-address limit. Two routers, because of compression:
 * `tiles` is mounted before it (tiles are stored gzipped and sent as they
 * are; glyphs and sprite images hardly compress) and `documents` after it
 * (the styles and the sprite JSON, which compress well; it also ends the
 * `/map` paths with a 404). The styles answer `no-cache` with an ETag, so
 * that a new bundle reaches a map at its next load; tiles, fonts and sprites
 * carry the bundle's id or the assets' hash in the path and are immutable.
 * Every name in a path is checked against what is open or listed — a bundle,
 * a font stack, a sprite file — and only numbers of a tile's grid go
 * further, so no request names a file. A tile is never inflated here: a
 * client that takes no gzip gets a 406.
 */
export function mapRouter(input: {
  basemap: Basemap;
  logger: Logger;
  perMinute: number;
  /** `PUBLIC_URL` and `ADDITIONAL_ORIGINS`: the styles' URLs are on the one a request came to. */
  allowedOrigins: readonly string[];
  /** `PUBLIC_URL`: the origin for any other host. */
  publicUrl: string;
}): {
  tiles: Router;
  documents: Router;
} {
  const { basemap } = input;
  const tiles = express.Router();
  const documents = express.Router();
  tiles.use(
    ipRateLimit({
      limit: input.perMinute,
      windowMs: 60_000,
      logger: input.logger,
      identifier: "map",
    }),
  );

  documents.get("/styles/:file", (req, res) => {
    const name = styleNames[req.params.file];
    if (name === undefined) {
      notFound(res);
      return;
    }
    const style = basemap.style(
      name,
      requestOrigin(req, input.allowedOrigins, input.publicUrl.replace(/\/+$/, "")),
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", style.etag);
    if (etagMatches(req.get("if-none-match"), style.etag)) {
      res.status(304).end();
      return;
    }
    res.type("application/json").send(style.body);
  });

  tiles.get("/tiles/:bundle/:z/:x/:y", async (req, res) => {
    const coordinates = tileCoordinates(req.params.z, req.params.x, req.params.y);
    const bundle = /^[0-9a-f]{16}$/.test(req.params.bundle)
      ? basemap.bundle(req.params.bundle)
      : null;
    if (coordinates === null || bundle === null) {
      notFound(res);
      return;
    }
    const { z, x, y } = coordinates;
    let tile: Awaited<ReturnType<typeof bundleTile>>;
    try {
      tile = await bundleTile(bundle, z, x, y);
    } catch (error) {
      // Whatever went wrong is not the tile's answer for good: never cached.
      if (error instanceof ArchiveClosedError) {
        notFound(res);
        return;
      }
      input.logger.warn({ err: error }, "basemap: a tile could not be read");
      res.status(500).setHeader("Cache-Control", "no-store");
      res.type("text/plain").send("The tile could not be read.");
      return;
    }
    const etag = `"${bundle.id}"`;
    if (tile === null) {
      res.setHeader("Cache-Control", immutable);
      res.setHeader("ETag", etag);
      res.status(etagMatches(req.get("if-none-match"), etag) ? 304 : 204).end();
      return;
    }
    const gzipped = tile.compression === "gzip";
    if (gzipped && req.acceptsEncodings("gzip") !== "gzip") {
      // Tiles are kept gzipped and sent so: nothing is inflated on a request.
      res.status(406).setHeader("Cache-Control", "no-store");
      res.setHeader("Vary", "Accept-Encoding");
      res.type("text/plain").send("This tile is served gzipped: send Accept-Encoding: gzip.");
      return;
    }
    // The caching headers go on only now, with the answer itself.
    res.setHeader("Cache-Control", immutable);
    res.setHeader("ETag", etag);
    if (gzipped) res.setHeader("Vary", "Accept-Encoding");
    if (etagMatches(req.get("if-none-match"), etag)) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", "application/x-protobuf");
    if (gzipped) res.setHeader("Content-Encoding", "gzip");
    res.send(tile.data);
  });

  tiles.get("/assets/:hash/fonts/:stack/:file", (req, res, next) => {
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

  /** A sprite file of the image: the PNGs go out as they are, the JSON after compression. */
  const sprite = (json: boolean): RequestHandler<{ hash: string; file: string }> => {
    return (req, res, next) => {
      const { assets } = basemap;
      const { hash, file } = req.params;
      const known = (spriteFiles as readonly string[]).includes(file);
      if (assets === null || hash !== assets.hash || !known) {
        if (json) notFound(res);
        else next();
        return;
      }
      const isJson = !file.endsWith(".png");
      if (isJson !== json) {
        next();
        return;
      }
      sendAsset(
        res,
        join(assets.dir, "sprites", file),
        isJson ? "application/json" : "image/png",
        next,
      );
    };
  };
  tiles.get("/assets/:hash/sprites/:file", sprite(false));
  documents.get("/assets/:hash/sprites/:file", sprite(true));

  documents.use((_req, res) => notFound(res));
  return { tiles, documents };
}
