import { WebAuthnError } from "@simplewebauthn/browser";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/ApiError";
import { classifyAuthError } from "../src/auth/classifyAuthError";

const api = (code: ConstructorParameters<typeof ApiError>[0]["code"], status = 400) =>
  new ApiError({ status, code, message: `${code} message` });

describe("classifyAuthError", () => {
  it("recognises the sign-in outcomes the API reports", () => {
    expect(classifyAuthError(api("signup_not_allowed", 403))).toEqual({
      kind: "signup_not_allowed",
    });
    expect(classifyAuthError(api("no_passkey_for_origin", 409))).toEqual({
      kind: "no_passkey_for_origin",
    });
    expect(classifyAuthError(api("unknown_credential", 401))).toEqual({
      kind: "unknown_credential",
    });
    expect(classifyAuthError(api("ceremony_expired"))).toEqual({ kind: "expired" });
    expect(classifyAuthError(api("link_invalid", 404))).toEqual({ kind: "link_invalid" });
    expect(classifyAuthError(api("rate_limited", 429))).toEqual({ kind: "rate_limited" });
    expect(classifyAuthError(api("network", 0))).toEqual({
      kind: "network",
      message: "network message",
    });
  });

  it("recognises what the browser's passkey sheet reports", () => {
    const cancelled = new WebAuthnError({
      message: "The operation either timed out or was not allowed.",
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: new DOMException("not allowed", "NotAllowedError"),
    });
    expect(classifyAuthError(cancelled)).toEqual({ kind: "cancelled" });
    expect(classifyAuthError(new DOMException("exists", "InvalidStateError"))).toEqual({
      kind: "already_registered",
    });
    expect(classifyAuthError(new DOMException("insecure", "SecurityError"))).toEqual({
      kind: "insecure_origin",
    });
    expect(classifyAuthError(new Error("WebAuthn is not supported in this browser"))).toEqual({
      kind: "unsupported",
    });
  });
});
