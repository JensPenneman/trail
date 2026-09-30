import { ApiError } from "../api/ApiError";
import type { AuthProblem } from "./AuthProblem";

function errorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("name" in error)) return null;
  return typeof error.name === "string" ? error.name : null;
}

/**
 * Maps API errors and WebAuthn DOMExceptions (wrapped by SimpleWebAuthn, which
 * keeps the original `name`) onto the problems the screens explain.
 */
export function classifyAuthError(error: unknown): AuthProblem {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "signup_not_allowed":
        return { kind: "signup_not_allowed" };
      case "no_passkey_for_origin":
        return { kind: "no_passkey_for_origin" };
      case "unknown_credential":
        return { kind: "unknown_credential" };
      case "ceremony_expired":
        return { kind: "expired" };
      case "rate_limited":
        return { kind: "rate_limited" };
      case "link_invalid":
      case "not_found":
        return { kind: "link_invalid" };
      case "network":
        return { kind: "network", message: error.message };
      default:
        return { kind: "failed", message: error.message };
    }
  }
  switch (errorName(error)) {
    // The person closed the passkey sheet, it timed out, or no passkey matched.
    case "NotAllowedError":
    case "AbortError":
      return { kind: "cancelled" };
    case "InvalidStateError":
      return { kind: "already_registered" };
    case "SecurityError":
      return { kind: "insecure_origin" };
    case "NotSupportedError":
      return { kind: "unsupported" };
    default:
      break;
  }
  if (error instanceof Error && /not supported/i.test(error.message))
    return { kind: "unsupported" };
  return {
    kind: "failed",
    message: error instanceof Error ? error.message : "The passkey could not be used.",
  };
}
