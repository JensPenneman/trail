import type { ApiScope } from "@trail/contracts/apiScope";
import type { DataAccessKind, DataAccessResource } from "@trail/contracts/dataAccess";
import type { Request, Response } from "express";
import type { z } from "zod";
import type { AppContext } from "../appContext";
import {
  getRequestAuth,
  hasScope,
  type RequestAuth,
  type TokenPrincipal,
} from "../auth/requestAuth";
import type { AccessOwner } from "../dataAccess/accessRecord";
import { inputResource } from "../dataAccess/inputResource";
import { personActor, principalActor } from "../dataAccess/principalActor";
import { hasBody } from "../http/hasBody";
import { HttpError, notFound } from "../http/httpError";
import { validationError } from "../http/validationError";
import { accessPathId } from "./accessPathId";
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

/**
 * A scoped route: any one of `scopes` grants access, all of them with `all: true`.
 * `allDevices`: what the route answers is the whole account's (the data access
 * log), so a token limited to some devices may not call it.
 */
type ScopeRule = {
  readonly scopes: readonly [ApiScope, ...ApiScope[]];
  readonly all?: boolean;
  readonly allDevices?: true;
};

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

/**
 * How a scoped route counts in the data access log (docs/architecture.md
 * §8.8). Every answer it sends with a success status is recorded for the
 * caller's account — the action is the operationId, the resource what the
 * validated path, query and body name — unless the spec says `false`.
 */
type RouteAccess =
  | false
  | {
      /** `read` for GET, `write` for the other methods, unless it says otherwise. */
      readonly kind?: DataAccessKind;
      /**
       * The answer holds other people's data (the people routes): the
       * handler names their owners in `owners`, and each of them gets an
       * access in their own log (channel `people`); the caller gets none.
       */
      readonly people?: true;
    };

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
  /** The data access log: recorded automatically on scoped routes (see `RouteAccess`). */
  readonly access?: RouteAccess;
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

/**
 * What the data access log learns from the handler besides the input: the
 * owners whose data a people route's answer holds (required there), or what
 * else the answer names for the caller's own log, such as a new share's id.
 */
type ResultAccess<A> = A extends { readonly people: true }
  ? { owners: readonly AccessOwner[] }
  : { resource?: DataAccessResource };

/** One of the spec's success statuses with a body of its schema's input type (no body for null). */
type RouteResult<R extends RouteResponses, A> = {
  [S in keyof R & SuccessStatus]: (R[S] extends z.ZodType
    ? { status: S; body: z.input<R[S]>; headers?: ResponseHeaders }
    : { status: S; headers?: ResponseHeaders }) &
    ResultAccess<A>;
}[keyof R & SuccessStatus];

export type RouteHandler<Spec extends RouteSpec> = (
  input: RouteInput<Spec>,
) =>
  | RouteResult<Spec["responses"], Spec["access"]>
  | Promise<RouteResult<Spec["responses"], Spec["access"]>>;

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
  owners?: readonly AccessOwner[];
  resource?: DataAccessResource;
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
        ? "Send an API token as Authorization: Bearer trlk_…"
        : "Sign in, or send an API token as Authorization: Bearer trlk_…",
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
  if (rule.allDevices === true && auth.kind === "token" && auth.deviceIds !== null) {
    res.setHeader(
      "WWW-Authenticate",
      `${realm}, error="insufficient_scope", scope="${rule.scopes.join(" ")}"`,
    );
    throw new HttpError(
      403,
      "insufficient_scope",
      "This API token is limited to some devices, and this answer covers the whole account: it needs a token for every device.",
    );
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

/**
 * Counts an answer that went out in the data access log: for the caller's
 * own account (their session on channel `web`, their token on `api`), or for
 * the owners a people route names — and then a token's call for its own
 * account too, without whom it showed. Public and token routes record nothing.
 * Never throws: the answer is out already, and the log must not fail it.
 */
function recordAccess(
  spec: RouteSpec,
  ctx: AppContext,
  input: UntypedInput,
  result: UntypedResult,
): void {
  const { auth, req } = input;
  if (spec.access === false || typeof spec.auth === "string" || auth === null) return;
  try {
    const access = spec.access?.kind ?? (spec.method === "get" ? "read" : "write");
    const facts = { action: spec.operationId, access, status: result.status };
    if (spec.access?.people === true) {
      for (const owner of result.owners ?? []) {
        ctx.dataAccess.record({
          ...facts,
          ownerUserId: owner.ownerUserId,
          channel: "people",
          actor: personActor(auth, owner.shareId),
          resource: owner.resource,
        });
      }
      // A token's call counts in its owner's log like every other: that it happened, not whom
      // it showed — that is the people's own business, in their logs.
      if (auth.kind === "token") {
        ctx.dataAccess.record({
          ...facts,
          ...principalActor(auth, null),
          ownerUserId: auth.user.id,
          resource: {},
        });
      }
      return;
    }
    ctx.dataAccess.record({
      ...facts,
      ...principalActor(auth, req.get("user-agent") ?? null),
      ownerUserId: auth.user.id,
      resource: {
        ...inputResource([input.params, input.query, input.body], accessPathId(spec.path)),
        ...result.resource,
      },
    });
  } catch (error) {
    (req.log ?? ctx.logger).error(
      { err: error, operationId: spec.operationId },
      "data access not recorded",
    );
  }
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
  if (typeof spec.auth === "string" && spec.access !== undefined) {
    throw new Error(`${spec.operationId} has no scopes, so the data access log never counts it`);
  }
}

/**
 * Defines a `/api/v1` operation (docs/architecture.md §8.3): the spec is the
 * single source for routing, validation, authorization and the OpenAPI
 * document, and the handler only ever sees a principal that may call the route
 * and input that matches the spec. A handler returns `{ status, body }` with a
 * status the spec lists; the body goes out through that status's schema, and
 * then the access counts in the data access log (§8.8).
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
      const result = await run(input);
      send(spec, ctx, result, req, res);
      // Only an answer that went out is an access: a refusal or a failure threw before here.
      recordAccess(spec, ctx, input, result);
    },
  };
}
