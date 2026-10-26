import { readFileSync } from "node:fs";
import { Validator } from "@seriousme/openapi-schema-validator";
import { apiScopeDescriptions, apiScopes } from "@trail/contracts/apiScope";
import { describe, expect, it } from "vitest";
import {
  buildOpenApiDocument,
  type OpenApiDocument,
} from "../../src/v1/openapi/buildOpenApiDocument";
import { readApiGuide } from "../../src/v1/openapi/readApiGuide";
import { v1Routes } from "../../src/v1/v1Routes";
import { v1Tags } from "../../src/v1/v1Tags";

const guide = readApiGuide();
const routes = v1Routes(() => {
  throw new Error("Nothing is served in this test");
});
const document = buildOpenApiDocument(
  { publicUrl: "https://trail.example.com", version: "1.2.3", guide },
  routes,
);

const httpMethods = ["get", "put", "post", "delete", "patch"] as const;

function operations(doc: OpenApiDocument) {
  return Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
    httpMethods.flatMap((method) => {
      const operation = item[method];
      return operation === undefined ? [] : [{ path, method, operation }];
    }),
  );
}

describe("the OpenAPI document", () => {
  it("is valid OpenAPI 3.1, as it is served", async () => {
    const validator = new Validator();
    // A string would be read as a file name: hand over the JSON as it goes over the wire.
    const result = await validator.validate(JSON.parse(JSON.stringify(document)));
    expect(result.errors ?? [], JSON.stringify(result.errors, null, 2)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(validator.version).toBe("3.1");
  });

  it("matches its snapshot (the guide aside, checked below)", async () => {
    const shown = { ...document, info: { ...document.info, description: "(docs/api.md)" } };
    await expect(`${JSON.stringify(shown, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/openapi.json",
    );
  });

  it("carries the guide as its description, without the guide's own title", () => {
    const file = readFileSync(new URL("../../../../docs/api.md", import.meta.url), "utf8");
    expect(file.startsWith("# Trail API\n")).toBe(true);
    expect(document.info.description).toBe(guide);
    expect(`# Trail API\n\n${guide}\n`).toBe(file);
  });

  it("lists in the guide exactly the scopes there are", () => {
    const rows = [...guide.matchAll(/^\| `([a-z]+:[a-z]+)` \| (.+) \|$/gm)].map((row) => [
      row[1],
      row[2],
    ]);
    expect(rows).toEqual(apiScopes.map((scope) => [scope, apiScopeDescriptions[scope]]));
  });

  it("names every operation once, tags it, and says who may call it", () => {
    const found = operations(document);
    expect(found).toHaveLength(routes.length);
    const ids = found.map(({ operation }) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const tagNames = v1Tags.map((tag) => tag.name);
    for (const { path, operation } of found) {
      expect(operation.summary, path).toBeTruthy();
      expect(
        operation.tags?.every((tag) => (tagNames as string[]).includes(tag)),
        path,
      ).toBe(true);
      expect(operation.description, path).toMatch(/\*\*Access:\*\* /);
      expect(operation.security, path).toBeDefined();
    }
    for (const tag of tagNames) {
      expect(
        found.some(({ operation }) => operation.tags?.includes(tag)),
        `tag ${tag}`,
      ).toBe(true);
    }
  });

  it("refers only to responses it defines", () => {
    const defined = Object.keys(document.components?.responses ?? {});
    const refs = [...JSON.stringify(document).matchAll(/"#\/components\/responses\/(\w+)"/g)].map(
      (match) => match[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(defined).toContain(ref);
  });

  it("refuses two routes for one method and path", () => {
    expect(() =>
      buildOpenApiDocument({ publicUrl: "https://trail.example.com", version: "1", guide }, [
        ...routes,
        ...routes.slice(0, 1),
      ]),
    ).toThrow(/Two routes for GET \/api\/v1\/me/);
  });
});
