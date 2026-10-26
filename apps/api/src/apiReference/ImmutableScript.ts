import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { Request, Response } from "express";

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

type Encoding = "br" | "gzip";

/** Below this the bytes saved are not worth an encoding (the compression middleware's threshold too). */
const encodeFrom = 1024;

/**
 * A script served under a name that carries its hash, so it can be cached for a
 * year. Its compressed forms are made once, on first request, and kept: the
 * API reference bundle is 4.6 MB, and compressing it again for every visitor
 * would be the cheapest way to keep the server busy.
 */
export class ImmutableScript {
  /** `<base>-<hash>.js` */
  readonly fileName: string;
  readonly #body: Buffer;
  readonly #encoded = new Map<Encoding, Promise<Buffer>>();

  constructor(base: string, body: Buffer | string) {
    this.#body = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const hash = createHash("sha256").update(this.#body).digest("hex").slice(0, 12);
    this.fileName = `${base}-${hash}.js`;
  }

  #encode(encoding: Encoding): Promise<Buffer> {
    let encoded = this.#encoded.get(encoding);
    if (encoded === undefined) {
      encoded =
        encoding === "br"
          ? brotli(this.#body, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: 9,
                [constants.BROTLI_PARAM_SIZE_HINT]: this.#body.length,
              },
            })
          : gzipped(this.#body, { level: 9 });
      // A failed compression is retried by the next request instead of being remembered.
      encoded.catch(() => this.#encoded.delete(encoding));
      this.#encoded.set(encoding, encoded);
    }
    return encoded;
  }

  async send(req: Request, res: Response): Promise<void> {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Vary", "Accept-Encoding");
    const accepted = this.#body.length < encodeFrom ? false : req.acceptsEncodings("br", "gzip");
    if (accepted === "br" || accepted === "gzip") {
      const body = await this.#encode(accepted);
      res.setHeader("Content-Encoding", accepted);
      res.send(body);
      return;
    }
    res.send(this.#body);
  }
}
