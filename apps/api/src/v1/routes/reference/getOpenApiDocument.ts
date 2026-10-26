import { defineRoute, type V1Route } from "../../defineRoute";
import { openApiDocumentSchema, type ServedDocument } from "../../openapi/servedDocument";

/** `GET /api/v1/openapi.json` — the document describes itself, so it is a route like the others. */
export function getOpenApiDocument(served: () => ServedDocument): V1Route {
  return defineRoute(
    {
      method: "get",
      path: "/api/v1/openapi.json",
      operationId: "getOpenApiDocument",
      summary: "Get the OpenAPI document",
      description:
        "This API described in OpenAPI 3.1, for code generators, HTTP clients and this reference. It changes only with a new release of Trail: cache it for five minutes and revalidate with `If-None-Match`.",
      tags: ["Reference"],
      auth: "public",
      responses: { 200: openApiDocumentSchema },
    },
    () => {
      const { document, etag } = served();
      return {
        status: 200,
        body: document,
        headers: { ETag: etag, "Cache-Control": "public, max-age=300" },
      };
    },
  );
}
