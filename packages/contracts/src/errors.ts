import { z } from "zod";

/** Machine-readable error codes of the dashboard API (`/api/**` except the Overland ingest). */
export const errorCodes = [
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "rate_limited",
  "origin_not_allowed",
  "signup_not_allowed",
  "no_passkey_for_origin",
  "ceremony_expired",
  "webauthn_failed",
  "unknown_credential",
  "link_invalid",
  "last_passkey",
  "internal",
  "unavailable",
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * Error body of every non-2xx dashboard API response.
 * `fields` maps a request field path (dot-joined) to its validation messages.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
