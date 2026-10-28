import type {
  ZodOpenApiHeaderObject,
  ZodOpenApiParameterObject,
  ZodOpenApiResponseObject,
} from "zod-openapi";

/*
 * The parts of the document a conditional GET shares (docs/architecture.md
 * §8.9): the `If-None-Match` it takes, the `ETag` its 200 carries and the
 * `304 Not Modified` it answers when the two are the same.
 */

const etagExample = 'W/"q8Zr2mXnB4vT1cKd9LsE0a"';

const etagHeader: ZodOpenApiHeaderObject = {
  description:
    "A weak validator of this answer. Send it back as `If-None-Match` to get `304 Not Modified` while the answer stays the same. It is opaque: compare it, never parse it.",
  schema: { type: "string" },
  example: etagExample,
};

const ifNoneMatch: ZodOpenApiParameterObject = {
  name: "If-None-Match",
  in: "header",
  required: false,
  description:
    "The `ETag` of an answer to the same request: when it still stands, the answer is `304 Not Modified` without a body. Several are allowed, separated by commas.",
  schema: { type: "string" },
  example: etagExample,
};

const notModified: ZodOpenApiResponseObject = {
  description:
    "Not modified: the answer whose `ETag` the request sent in `If-None-Match` still stands. No body.",
  headers: { ETag: { $ref: "#/components/headers/ETag" } },
};

/** `components.headers`, `components.parameters` and the 304 of `components.responses`. */
export const conditionalComponents = {
  headers: { ETag: etagHeader },
  parameters: { IfNoneMatch: ifNoneMatch },
  responses: { NotModified: notModified },
};

/** References for the operations of a route that answers 304. */
export const conditionalReferences = {
  etagHeader: { $ref: "#/components/headers/ETag" },
  ifNoneMatch: { $ref: "#/components/parameters/IfNoneMatch" },
  notModified: { $ref: "#/components/responses/NotModified" },
} as const;
