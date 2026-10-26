import { createHash } from "node:crypto";
import { z } from "zod";
import type { OpenApiDocument } from "./buildOpenApiDocument";

/** What `GET /api/v1/openapi.json` answers with (named parts only; the rest passes through). */
export const openApiDocumentSchema = z
  .looseObject({
    openapi: z.string().meta({ example: "3.1.1" }),
    info: z.looseObject({ title: z.string(), version: z.string() }),
  })
  .meta({ description: "An OpenAPI 3.1 document: this one." });

/** The document as it is served: JSON-shaped, with a validator for conditional requests. */
export interface ServedDocument {
  document: z.output<typeof openApiDocumentSchema>;
  etag: string;
}

/** Prepares the document for serving, once per process. */
export function serveDocument(document: OpenApiDocument): ServedDocument {
  const json = JSON.stringify(document);
  const hash = createHash("sha256").update(json).digest("base64url").slice(0, 27);
  // A weak validator: compression changes the bytes on the wire, never the document.
  return { document: openApiDocumentSchema.parse(JSON.parse(json)), etag: `W/"${hash}"` };
}
