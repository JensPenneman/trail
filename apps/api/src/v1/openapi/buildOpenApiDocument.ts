import { apiScopeDescriptions, apiScopeSchema, apiScopes } from "@trail/contracts/apiScope";
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
} from "zod-openapi";
import type { RouteAuth, RouteSpec, SuccessStatus, V1Route } from "../defineRoute";
import { pathParameters } from "../toExpressPath";
import { v1Tags } from "../v1Tags";
import {
  type ErrorStatus,
  errorResponseComponents,
  errorResponseReference,
} from "./errorResponses";

/** The generated document (zod-openapi types it for 3.2, a superset of the 3.1.1 it writes). */
export type OpenApiDocument = ReturnType<typeof createDocument>;

export interface OpenApiInfo {
  /** `PUBLIC_URL`, the server the document names. */
  publicUrl: string;
  /** The running build's version. */
  version: string;
  /** docs/api.md without its title: the guide above the operations. */
  guide: string;
}

const successDescriptions: Record<SuccessStatus, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No content",
};

/** The error statuses an operation can answer with, from what its spec declares. */
function errorStatusesOf(spec: RouteSpec): ErrorStatus[] {
  const statuses = new Set<ErrorStatus>([429, 500]);
  const request = spec.request ?? {};
  // A token route checks no scope (no 403) and refuses a session with a 400.
  if (spec.auth === "token") for (const status of [400, 401, 503] as const) statuses.add(status);
  else if (spec.auth !== "public") {
    for (const status of [401, 403, 503] as const) statuses.add(status);
  }
  if (pathParameters(spec.path).length > 0) statuses.add(404);
  if (request.query !== undefined || request.body !== undefined) statuses.add(400);
  if (request.body !== undefined) for (const status of [413, 415] as const) statuses.add(status);
  for (const status of spec.errors ?? []) statuses.add(status);
  return [...statuses].sort((a, b) => a - b);
}

const code = (scope: string) => `\`${scope}\``;

function accessNote(auth: RouteAuth): string {
  if (auth === "public") return "**Access:** public, no credential needed.";
  if (auth === "token") return "**Access:** any API token, whatever its scopes; not a session.";
  const scopes = auth.scopes.map(code);
  const needed =
    scopes.length === 1
      ? `the scope ${scopes.join("")}`
      : auth.all === true
        ? `the scopes ${scopes.join(" and ")}`
        : `one of the scopes ${scopes.join(", ")}`;
  return `**Access:** an API token with ${needed}, or a signed-in session.`;
}

/** Any listed scope grants access: one security requirement per scope; `all` needs them together. */
function securityOf(auth: RouteAuth): NonNullable<ZodOpenApiOperationObject["security"]> {
  if (auth === "public") return [];
  if (auth === "token") return [{ bearer: [] }];
  if (auth.all === true) return [{ bearer: [...auth.scopes] }];
  return auth.scopes.map((scope) => ({ bearer: [scope] }));
}

function responsesOf(spec: RouteSpec): ZodOpenApiResponsesObject {
  const responses: ZodOpenApiResponsesObject = {};
  for (const [key, schema] of Object.entries(spec.responses)) {
    const status = Number(key) as SuccessStatus;
    responses[`${status}`] =
      schema === null || schema === undefined
        ? { description: successDescriptions[status] }
        : {
            description: schema.description ?? successDescriptions[status],
            content: { "application/json": { schema } },
          };
  }
  for (const status of errorStatusesOf(spec)) {
    responses[`${status}`] = errorResponseReference(status);
  }
  return responses;
}

function operationOf(spec: RouteSpec): ZodOpenApiOperationObject {
  const { params, query, body } = spec.request ?? {};
  return {
    operationId: spec.operationId,
    summary: spec.summary,
    description: `${spec.description}\n\n${accessNote(spec.auth)}`,
    tags: [...spec.tags],
    security: securityOf(spec.auth),
    ...(params === undefined && query === undefined
      ? {}
      : {
          requestParams: {
            ...(params === undefined ? {} : { path: params }),
            ...(query === undefined ? {} : { query }),
          },
        }),
    ...(body === undefined
      ? {}
      : { requestBody: { required: true, content: { "application/json": { schema: body } } } }),
    responses: responsesOf(spec),
  };
}

const bearerDescription = [
  "An API token, sent as `Authorization: Bearer trlk_…`. Its scopes decide what it may do; an operation lists the scopes that grant access to it.",
  "",
  "| Scope | Allows |",
  "|---|---|",
  ...apiScopes.map((scope) => `| ${code(scope)} | ${apiScopeDescriptions[scope]} |`),
].join("\n");

/**
 * The OpenAPI 3.1 document of `/api/v1`, generated from the route specs (the
 * zod contracts become JSON Schema: request parts as input, responses as
 * output). The server builds it once per process.
 */
export function buildOpenApiDocument(
  info: OpenApiInfo,
  routes: readonly V1Route[],
): OpenApiDocument {
  const paths: ZodOpenApiPathsObject = {};
  for (const { spec } of routes) {
    const item = paths[spec.path] ?? {};
    if (item[spec.method] !== undefined) {
      throw new Error(`Two routes for ${spec.method.toUpperCase()} ${spec.path}`);
    }
    item[spec.method] = operationOf(spec);
    paths[spec.path] = item;
  }
  return createDocument(
    {
      openapi: "3.1.1",
      info: { title: "Trail API", version: info.version, description: info.guide },
      servers: [{ url: info.publicUrl }],
      tags: v1Tags.map((tag) => ({ ...tag })),
      paths,
      components: {
        securitySchemes: {
          bearer: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "trlk_…",
            description: bearerDescription,
          },
        },
        schemas: { ApiScope: apiScopeSchema },
        responses: errorResponseComponents(),
      },
    },
    {
      // zod spells out its UUID and ISO date-time checks as long regular expressions. The format
      // names the same thing (the guide says responses use UTC), and a screen-wide regex on every
      // id and timestamp would bury the reference.
      override: ({ jsonSchema }) => {
        if (jsonSchema.format === "uuid" || jsonSchema.format === "date-time") {
          delete jsonSchema.pattern;
        }
      },
    },
  );
}
