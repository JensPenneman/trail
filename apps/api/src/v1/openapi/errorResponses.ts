import type { ErrorCode } from "@trail/contracts/errors";
import { z } from "zod";
import type { ZodOpenApiResponseObject } from "zod-openapi";

interface ErrorResponse {
  /** Component name of the response. */
  name: string;
  description: string;
  codes: readonly [ErrorCode, ...ErrorCode[]];
  headers?: Record<string, { description: string; always: boolean }>;
}

/**
 * The error answers of `/api/v1`, one shared OpenAPI response per status, with
 * every code that status can carry. Operations refer to them; which ones each
 * operation lists follows from its spec (`errorStatusesOf`).
 */
const errors = {
  400: {
    name: "BadRequest",
    description:
      "The request is invalid: `validation_failed` lists the offending fields in `fields`; `bad_request` means unreadable JSON, or a session calling an operation that only an API token can call.",
    codes: ["validation_failed", "bad_request"],
  },
  401: {
    name: "Unauthorized",
    description:
      "No credential, or a refused one: `token_expired` for an API token past its expiry, `unauthorized` for everything else (an unknown, revoked or malformed token, or one used from an address it does not allow).",
    codes: ["unauthorized", "token_expired"],
    headers: {
      "WWW-Authenticate": {
        description:
          'The challenge: `Bearer realm="trail"`, with `error="invalid_token"` when a token was refused.',
        always: true,
      },
    },
  },
  403: {
    name: "Forbidden",
    description:
      "Authenticated, but not allowed: `insufficient_scope` when the API token lacks a scope (the message names it), `forbidden` for what only a signed-in browser may do, `origin_not_allowed` when a browser session calls from another site.",
    codes: ["insufficient_scope", "forbidden", "origin_not_allowed"],
    headers: {
      "WWW-Authenticate": {
        description:
          'With `insufficient_scope`: `Bearer realm="trail", error="insufficient_scope", scope="…"`, naming the missing scopes.',
        always: false,
      },
    },
  },
  404: {
    name: "NotFound",
    description:
      "No such resource. Ids that do not exist, belong to someone else, are malformed or lie outside the token's devices all look the same.",
    codes: ["not_found"],
  },
  409: {
    name: "Conflict",
    description: "The change conflicts with the current state.",
    codes: ["conflict"],
  },
  413: {
    name: "PayloadTooLarge",
    description: "The request body is larger than 100 kB.",
    codes: ["payload_too_large"],
  },
  415: {
    name: "UnsupportedMediaType",
    description: "The request body is not `application/json`.",
    codes: ["bad_request"],
  },
  429: {
    name: "TooManyRequests",
    description:
      "A rate limit was reached: per client address, per API token, or for refused tokens per address. Retry after the time given.",
    codes: ["rate_limited"],
    headers: {
      "Retry-After": { description: "Seconds until the limit resets.", always: true },
      RateLimit: {
        description: "The remaining quota of each limit that applies (IETF draft 8).",
        always: true,
      },
      "RateLimit-Policy": {
        description: "The limits that apply (IETF draft 8).",
        always: true,
      },
    },
  },
  500: {
    name: "InternalError",
    description: "Something went wrong on the server; it has been logged.",
    codes: ["internal"],
  },
  503: {
    name: "Unavailable",
    description: "The database is temporarily unavailable. Retry shortly.",
    codes: ["unavailable"],
  },
} as const satisfies Record<number, ErrorResponse>;

export type ErrorStatus = keyof typeof errors;

/* The body of `{ error: { code, message, fields? } }` with this status's codes,
 * inline: one model per status would only crowd the reference's model list. */
const errorBody = (response: ErrorResponse) =>
  z.object({
    error: z.object({
      code: z
        .enum(response.codes)
        .meta({ description: "Machine-readable; see Errors in the guide." }),
      message: z.string().meta({ description: "For people; the wording may change." }),
      ...(response.codes.includes("validation_failed")
        ? {
            fields: z.record(z.string(), z.array(z.string())).optional().meta({
              description: "Validation messages by request field (a dot-joined path).",
            }),
          }
        : {}),
    }),
  });

function responseOf(response: ErrorResponse): ZodOpenApiResponseObject {
  const headers = Object.entries(response.headers ?? {});
  return {
    description: response.description,
    content: { "application/json": { schema: errorBody(response) } },
    ...(headers.length === 0
      ? {}
      : {
          headers: z.object(
            Object.fromEntries(
              headers.map(([name, header]) => {
                const value = z.string().meta({ description: header.description });
                return [name, header.always ? value : value.optional()];
              }),
            ),
          ),
        }),
  };
}

/** `components.responses` of the document. */
export function errorResponseComponents(): Record<string, ZodOpenApiResponseObject> {
  return Object.fromEntries(
    Object.values(errors).map((response) => [response.name, responseOf(response)]),
  );
}

/** A reference to the shared response of `status`. */
export const errorResponseReference = (status: ErrorStatus): { $ref: string } => ({
  $ref: `#/components/responses/${errors[status].name}`,
});
