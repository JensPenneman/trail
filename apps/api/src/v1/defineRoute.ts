import type { ApiScope } from "@trail/contracts/apiScope";
import type { Request, Response } from "express";
import type { z } from "zod";
import type { AppContext } from "../appContext";
import {
  getRequestAuth,
  hasScope,
  type RequestAuth,
  type TokenPrincipal,
} from "../auth/requestAuth";
import { hasBody } from "../http/hasBody";
import { HttpError, notFound } from "../http/httpError";
import { validationError } from "../http/validationError";
import type { ErrorStatus } from "./openapi/errorResponses";
import { pathParameters, toExpressPath } from "./toExpressPath";
import type { V1TagName } from "./v1Tags";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** What a handler may answer; errors are thrown as `HttpError`s instead. */
export type SuccessStatus = 200 | 201 | 202 | 204;

/**
 * Who may call a route: anyone (`"public"`), any API token whatever its scopes
 * (`"token"`, for operations about the calling token itself), or a principal
 * holding one of `scopes` — all of them with `all: true`. A session holds every
 * scope, so the signed-in dashboard may call every scoped route; an API token
 * only what its scopes allow.
 */
export type RouteAuth = "public" | "token" | ScopeRule;

/** A scoped route: any one of `scopes` grants access, all of them with `all: true`. */
type ScopeRule = { readonly scopes: readonly [ApiScope, ...ApiScope[]]; readonly all?: boolean };

/** The validated parts of a request: zod objects for the path and the query string. */
interface RouteRequest {
  /** One key per `{param}` of the path; a value that fails it answers 404 (it names nothing). */
  readonly params?: z.ZodObject;
  /** Query parameters arrive as strings: coerce numbers and split lists in the schema. */
  readonly query?: z.ZodObject;
  /** A JSON body (100 kB at most). */
  readonly body?: z.ZodType;
}

/** The body schema of each success status; null for a status without a body (204). */
type RouteResponses = { readonly [S in SuccessStatus]?: z.ZodType | null };

export interface RouteSpec {
  readonly method: HttpMethod;
  /** OpenAPI path template, parameters in braces: `/api/v1/devices/{id}`. */
  readonly path: `/api/v1/${string}`;
  /** Unique, lowerCamelCase: the operation's name in the document and in generated clients. */
  readonly operationId: string;
  /** A few words, shown in the reference's sidebar ("List devices"). */
  readonly summary: string;
  /** Markdown; the reference appends who may call the route. */
  readonly description: string;
  readonly tags: readonly [V1TagName, ...V1TagName[]];
  readonly auth: RouteAuth;
  readonly request?: RouteRequest;
  readonly responses: RouteResponses;
  /**
   * Error statuses to document beyond the ones the spec implies: 401 and 403
   * (scopes), 404 (path parameters), 400 (query or body), 413 and 415 (body),
   * 429 and 500 (always), 503 (any non-public route). For example `[409]`.
   */
  readonly errors?: readonly ErrorStatus[];
}

type Parsed<S> = S extends z.ZodType ? z.output<S> : undefined;
type RequestPart<Spec extends RouteSpec, K extends keyof RouteRequest> =
  Spec["request"] extends Record<K, infer S> ? Parsed<S> : undefined;

/** What a handler gets: the principal and the request, validated against the spec. */
interface RouteInput<Spec extends RouteSpec> {
  ctx: AppContext;
  /**
   * Always a principal on a scoped route, and a token on a token route. A public
   * route never loads the session (`createV1Router`), so there it is the API
   * token's principal or null.
   */
  auth: Spec["auth"] extends "public"
    ? RequestAuth | null
    : Spec["auth"] extends "token"
      ? TokenPrincipal
      : RequestAuth;
  /** `undefined` when the spec has no such part. */
  params: RequestPart<Spec, "params">;
  query: RequestPart<Spec, "query">;
  body: RequestPart<Spec, "body">;
  /**
   * For what the spec does not cover (request headers, `req.log`). The response
   * is not the handler's to write: it returns the result instead.
   */
  req: Request;
}

type ResponseHeaders = Readonly<Record<string, string>>;

/** One of the spec's success statuses with a body of its schema's input type (no body for null). */
type RouteResult<R extends RouteResponses> = {
  [S in keyof R & SuccessStatus]: R[S] extends z.ZodType
    ? { status: S; body: z.input<R[S]>; headers?: ResponseHeaders }
    : { status: S; headers?: ResponseHeaders };
}[keyof R & SuccessStatus];

export type RouteHandler<Spec extends RouteSpec> = (
  input: RouteInput<Spec>,
) => RouteResult<Spec["responses"]> | Promise<RouteResult<Spec["responses"]>>;

/** A defined route: its spec (for the OpenAPI document) and its Express handler (for the router). */
export interface V1Route {
  readonly spec: RouteSpec;
  /** The Express path below the router's mount point (`/api/v1`): `/devices/:id`. */
  readonly expressPath: string;
  /** Authorizes, validates, runs the handler and sends its result through the response schema. */
  readonly handle: (ctx: AppContext, req: Request, res: Response) => Promise<void>;
}

interface UntypedInput {
  ctx: AppContext;
  auth: RequestAuth | null;
  params: unknown;
  query: unknown;
  body: unknown;
  req: Request;
}

interface UntypedResult {
  status: SuccessStatus;
  body?: unknown;
  headers?: ResponseHeaders;
}

const realm = 'Bearer realm="trail"';
const routePrefix = "/api/v1";

/** The scopes the principal lacks for `rule`; empty when it may go ahead. */
export function missingScopes(auth: RequestAuth, rule: ScopeRule): readonly ApiScope[] {
  const lacking = rule.scopes.filter((scope) => !hasScope(auth, scope));
  if (rule.all === true || lacking.length === rule.scopes.length) return lacking;
  return [];
}

function scopeMessage(rule: ScopeRule, missing: readonly ApiScope[]): string {
  const list = missing.join(", ");
  if (rule.all === true || missing.length === 1) {
    return `This API token lacks the scope${missing.length > 1 ? "s" : ""} ${list}.`;
  }
  return `This API token needs one of the scopes ${list}.`;
}

function authorize(rule: RouteAuth, req: Request, res: Response): RequestAuth | null {
  const auth = getRequestAuth(req) ?? null;
  if (rule === "public") return auth;
  if (auth === null) {
    res.setHeader("WWW-Authenticate", realm);
    throw new HttpError(
      401,
      "unauthorized",
      rule === "token"
        ? "Send an API token as Authorization: Bearer trlk_…."
        : "Sign in, or send an API token as Authorization: Bearer trlk_….",
    );
  }
  if (rule === "token") {
    // Not a 403: nothing is refused to the person, the request just has no token to talk about.
    if (auth.kind !== "token") {
      throw new HttpError(
        400,
        "bad_request",
        "This operation is about the API token that calls it: send one as Authorization: Bearer trlk_…, not a session.",
      );
    }
    return auth;
  }
  const missing = missingScopes(auth, rule);
  if (missing.length > 0) {
    res.setHeader(
      "WWW-Authenticate",
      `${realm}, error="insufficient_scope", scope="${missing.join(" ")}"`,
    );
    throw new HttpError(403, "insufficient_scope", scopeMessage(rule, missing));
  }
  return auth;
}

function validParams(schema: z.ZodObject | undefined, req: Request): unknown {
  if (schema === undefined) return undefined;
  const result = schema.safeParse(req.params);
  // A malformed id names nothing, just like an unknown one: 404, not 400.
  if (!result.success) throw notFound();
  return result.data;
}

function validQuery(schema: z.ZodObject | undefined, req: Request): unknown {
  if (schema === undefined) return undefined;
  const result = schema.safeParse(req.query);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function validBody(schema: z.ZodType | undefined, req: Request): unknown {
  if (schema === undefined) return undefined;
  if (hasBody(req) && req.is(["application/json", "application/*+json"]) === false) {
    throw new HttpError(415, "bad_request", "Send the request body as application/json.");
  }
  const result = schema.safeParse(req.body);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function send(
  spec: RouteSpec,
  ctx: AppContext,
  result: UntypedResult,
  req: Request,
  res: Response,
): void {
  const schema = spec.responses[result.status];
  if (schema === undefined) {
    throw new Error(`${spec.operationId} answered ${result.status}, which its spec does not list`);
  }
  if (schema === null) {
    if (result.headers !== undefined) res.set(result.headers);
    res.status(result.status).end();
    return;
  }
  // Parsing the output drops whatever the schema does not name: nothing undocumented leaks out.
  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    (req.log ?? ctx.logger).error(
      {
        operationId: spec.operationId,
        issues: parsed.error.issues.map(({ code, path, message }) => ({ code, path, message })),
      },
      "response does not match its schema",
    );
    throw new HttpError(500, "internal", "Something went wrong on the server.");
  }
  // Only now: an error answer must not carry the result's headers (an ETag, a max-age).
  if (result.headers !== undefined) res.set(result.headers);
  res.status(result.status).json(parsed.data);
}

/** Mistakes in a spec fail at startup (and in the unit tests), not on a request. */
function checkSpec(spec: RouteSpec): void {
  if (!/^[a-z][A-Za-z0-9]*$/.test(spec.operationId)) {
    throw new Error(`operationId ${spec.operationId} must be lowerCamelCase`);
  }
  const inPath = pathParameters(spec.path).sort();
  const declared = Object.keys(spec.request?.params?.shape ?? {}).sort();
  if (inPath.join() !== declared.join()) {
    throw new Error(
      `${spec.operationId}: path parameters {${inPath.join(", ")}} need exactly these keys in request.params, not [${declared.join(", ")}]`,
    );
  }
  if (Object.keys(spec.responses).length === 0) {
    throw new Error(`${spec.operationId} lists no response`);
  }
  // createV1Router mounts public routes before the session and the body parser.
  if (spec.auth === "public" && spec.request?.body !== undefined) {
    throw new Error(
      `${spec.operationId} is public and takes a body, which public routes never get`,
    );
  }
}

/**
 * Defines a `/api/v1` operation (docs/architecture.md §8.3): the spec is the
 * single source for routing, validation, authorization and the OpenAPI
 * document, and the handler only ever sees a principal that may call the route
 * and input that matches the spec. A handler returns `{ status, body }` with a
 * status the spec lists; the body goes out through that status's schema.
 */
export function defineRoute<const Spec extends RouteSpec>(
  spec: Spec,
  handler: RouteHandler<Spec>,
): V1Route {
  checkSpec(spec);
  // The input is validated against the spec just below, and the result type-checked against
  // it where the route is defined: erasing both types here only drops what is already proven.
  const run = handler as unknown as (input: UntypedInput) => UntypedResult | Promise<UntypedResult>;
  return {
    spec,
    expressPath: toExpressPath(spec.path).slice(routePrefix.length),
    async handle(ctx, req, res) {
      const auth = authorize(spec.auth, req, res);
      const input: UntypedInput = {
        ctx,
        auth,
        params: validParams(spec.request?.params, req),
        query: validQuery(spec.request?.query, req),
        body: validBody(spec.request?.body, req),
        req,
      };
      send(spec, ctx, await run(input), req, res);
    },
  };
}
