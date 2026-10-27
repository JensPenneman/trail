import { z } from "zod";
import { type ApiScope, apiScopeSchema, apiScopes } from "./apiScope";
import { ipNetworkSchema } from "./ipNetwork";

/*
 * API tokens (docs/architecture.md §8.4): the credentials of the public API.
 * They are managed by the signed-in person only (`/api/me/tokens`, never with
 * a token); `GET /api/v1/tokens/verify` lets a token describe itself.
 */

/** An API token secret: `trlk_` and 32 random bytes in base64url (43 characters). */
export const apiTokenSecretPattern = /^trlk_[A-Za-z0-9_-]{43}$/;

/** The secret of an API token, shown once: when it is created and after a roll. */
export const apiTokenSecretSchema = z.string().regex(apiTokenSecretPattern);

/** At most this many active (neither revoked nor expired) tokens per account. */
export const maxActiveApiTokens = 50;

/**
 * At most this many tokens per account in all, the revoked and expired ones
 * that are still kept included: the list stays bounded however many tokens
 * are created and revoked in a row.
 */
export const maxStoredApiTokens = 200;

/** At most this many entries in a token's address allowlist. */
export const maxAllowedIpNetworks = 20;

/** Revoked and expired tokens stay listed this long (the audit trail), then they are removed. */
export const apiTokenRetentionDays = 30;

export const apiTokenStatuses = ["active", "expired", "revoked"] as const;

export const apiTokenStatusSchema = z.enum(apiTokenStatuses).meta({
  id: "ApiTokenStatus",
  description:
    "`active` until the token is revoked or reaches its expiry; a token that is not active is refused.",
  example: "active",
});
export type ApiTokenStatus = z.infer<typeof apiTokenStatusSchema>;

const readScopes = apiScopes.filter((scope) => scope.endsWith(":read"));

/**
 * Starting points of the token dialog: Read-only (every `:read` scope), Agent
 * (read, plus correcting how you travelled, but not who looked at your data:
 * an agent has no business with the data access log) and Full access (every
 * scope).
 */
export const apiTokenTemplates = {
  "read-only": readScopes,
  agent: apiScopes.filter(
    (scope) => (scope.endsWith(":read") && scope !== "audit:read") || scope === "locations:write",
  ),
  full: [...apiScopes],
} as const satisfies Record<string, readonly ApiScope[]>;
export type ApiTokenTemplate = keyof typeof apiTokenTemplates;

/**
 * Scopes whose operations answer for the whole account (the data access
 * log): a token limited to some devices is refused there, so the token
 * dialog does not offer them with a device list.
 */
export const everyDeviceScopes: readonly ApiScope[] = ["audit:read"];

/** Scopes in the vocabulary's order, each once. */
export const normaliseScopes = (scopes: readonly ApiScope[]): ApiScope[] =>
  apiScopes.filter((scope) => scopes.includes(scope));

/** The template with exactly these scopes, or null for a set of one's own. */
export function templateOfScopes(scopes: readonly ApiScope[]): ApiTokenTemplate | null {
  const wanted = normaliseScopes(scopes).join();
  const names = Object.keys(apiTokenTemplates) as ApiTokenTemplate[];
  return names.find((name) => apiTokenTemplates[name].join() === wanted) ?? null;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** An API token as Settings › API tokens lists it; the secret itself is never stored. */
export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The last four characters of the secret, to tell tokens apart. */
  hint: z.string(),
  scopes: z.array(apiScopeSchema),
  /** Only these of the account's devices; null = all of them, also ones added later. */
  deviceIds: z.array(z.uuid()).nullable(),
  /** Only requests from these networks (CIDR, as the database writes them); null = any address. */
  allowedIps: z.array(z.string()).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  lastUsedIp: z.string().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  status: apiTokenStatusSchema,
});
export type ApiToken = z.infer<typeof apiTokenSchema>;

const tokenNameSchema = z.string().trim().min(1).max(60);
const tokenScopesSchema = z.array(apiScopeSchema).min(1).transform(normaliseScopes);
/** An empty list is a token for no device at all; null is every device. */
const tokenDeviceIdsSchema = z.array(z.uuid()).max(50).transform(unique).nullable();
const tokenAllowedIpsSchema = z
  .array(ipNetworkSchema)
  .min(1, "Give at least one address, or no allowlist at all")
  .max(maxAllowedIpNetworks)
  .transform(unique)
  .nullable();
/** Null = the token never expires; otherwise an instant in the future (checked by the API). */
const tokenExpiresAtSchema = z.iso.datetime({ offset: true }).nullable();

/** `POST /api/me/tokens` — the expiry is always stated, null for a token that never expires. */
export const createApiTokenRequestSchema = z.object({
  name: tokenNameSchema,
  scopes: tokenScopesSchema,
  deviceIds: tokenDeviceIdsSchema.default(null),
  allowedIps: tokenAllowedIpsSchema.default(null),
  expiresAt: tokenExpiresAtSchema,
});
export type CreateApiTokenRequest = z.input<typeof createApiTokenRequestSchema>;

/** `PATCH /api/me/tokens/:id` — any of the settings; the secret stays the same. */
export const updateApiTokenRequestSchema = z
  .object({
    name: tokenNameSchema.optional(),
    scopes: tokenScopesSchema.optional(),
    deviceIds: tokenDeviceIdsSchema.optional(),
    allowedIps: tokenAllowedIpsSchema.optional(),
    expiresAt: tokenExpiresAtSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateApiTokenRequest = z.input<typeof updateApiTokenRequestSchema>;

/** `GET /api/me/tokens` — newest first, revoked and expired ones too until they are removed. */
export const apiTokenListResponseSchema = z.object({ tokens: z.array(apiTokenSchema) });
export type ApiTokenListResponse = z.infer<typeof apiTokenListResponseSchema>;

/** `PATCH /api/me/tokens/:id` */
export const apiTokenResponseSchema = z.object({ token: apiTokenSchema });
export type ApiTokenResponse = z.infer<typeof apiTokenResponseSchema>;

/** `POST /api/me/tokens` (201) and `POST /api/me/tokens/:id/roll`: the one time the secret is shown. */
export const apiTokenWithSecretResponseSchema = z.object({
  token: apiTokenSchema,
  secret: apiTokenSecretSchema,
});
export type ApiTokenWithSecretResponse = z.infer<typeof apiTokenWithSecretResponseSchema>;

/** `GET /api/v1/tokens/verify` — the calling token, as its owner set it up. */
export const tokenVerificationSchema = z
  .object({
    id: z.uuid().meta({
      description: "The token's id.",
      example: "019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b",
    }),
    name: z.string().meta({
      description: "The name its owner gave it.",
      example: "Home Assistant",
    }),
    scopes: z.array(apiScopeSchema).meta({
      description: "What it may do.",
      example: ["devices:read", "locations:read"],
    }),
    deviceIds: z
      .array(z.uuid())
      .nullable()
      .meta({
        description:
          "The only devices it reaches; null for every device of the account, also ones added later.",
        example: ["0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"],
      }),
    expiresAt: z.iso.datetime().nullable().meta({
      description: "When it stops working; null when it never expires.",
      example: "2027-01-24T09:00:00.000Z",
    }),
    status: apiTokenStatusSchema,
  })
  .meta({
    id: "TokenVerification",
    description: "The API token that made the request.",
  });
export type TokenVerification = z.infer<typeof tokenVerificationSchema>;
