import { describe, expect, it } from "vitest";
import { isSignupAllowlisted } from "../../src/auth/isSignupAllowlisted";
import { ceremonyOriginFor, rpIdOf } from "../../src/auth/originPolicy";
import { providerForAaguid } from "../../src/auth/providerForAaguid";
import {
  clearedSessionCookie,
  plainSessionCookieName,
  secureSessionCookieName,
  sessionCookie,
  sessionCookieName,
} from "../../src/auth/sessionCookie";
import { userAgentLabel } from "../../src/auth/userAgentLabel";

describe("origin → RP ID policy", () => {
  const allowed = ["https://trail.example.com", "http://localhost:8080"];

  it("accepts allowed origins and derives the RP ID from the hostname", () => {
    expect(ceremonyOriginFor("https://trail.example.com", allowed)).toEqual({
      origin: "https://trail.example.com",
      rpId: "trail.example.com",
    });
    expect(ceremonyOriginFor("http://localhost:8080", allowed)).toEqual({
      origin: "http://localhost:8080",
      rpId: "localhost",
    });
    expect(rpIdOf("https://trail.example.com:8443")).toBe("trail.example.com");
  });

  it("rejects missing, foreign, look-alike and path-carrying origins", () => {
    for (const origin of [
      undefined,
      "null",
      "https://evil.example",
      "http://trail.example.com",
      "https://trail.example.com.evil.example",
      "http://localhost:5173",
      "https://trail.example.com/path",
    ]) {
      expect(ceremonyOriginFor(origin, allowed), String(origin)).toBeNull();
    }
  });
});

describe("isSignupAllowlisted", () => {
  const allowlist = ["jens@example.com", "*@family.example"];

  it("matches exact addresses and whole domains, case-insensitively", () => {
    expect(isSignupAllowlisted("Jens@Example.com", allowlist)).toBe(true);
    expect(isSignupAllowlisted("anyone@family.example", allowlist)).toBe(true);
    expect(isSignupAllowlisted("ANYONE@FAMILY.EXAMPLE", allowlist)).toBe(true);
  });

  it("does not match subdomains, look-alikes or other addresses", () => {
    expect(isSignupAllowlisted("a@sub.family.example", allowlist)).toBe(false);
    expect(isSignupAllowlisted("a@family.example.evil", allowlist)).toBe(false);
    expect(isSignupAllowlisted("other@example.com", allowlist)).toBe(false);
    expect(isSignupAllowlisted("jens@example.com", [])).toBe(false);
    expect(isSignupAllowlisted("not-an-address", ["*@family.example"])).toBe(false);
  });
});

describe("providerForAaguid", () => {
  it("names well-known passkey providers", () => {
    expect(providerForAaguid("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")).toBe("iCloud Keychain");
    expect(providerForAaguid("EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4")).toBe(
      "Google Password Manager",
    );
    expect(providerForAaguid("bada5566-a7aa-401f-bd96-45619a55120d")).toBe("1Password");
    expect(providerForAaguid("d548826e-79b4-db40-a3d8-11116f7e8349")).toBe("Bitwarden");
  });

  it("returns null for unknown and all-zero AAGUIDs", () => {
    expect(providerForAaguid("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(providerForAaguid("01020304-0506-0708-0102-030405060708")).toBeNull();
  });
});

describe("session cookie", () => {
  it("uses the __Host- prefix with Secure on HTTPS only", () => {
    expect(sessionCookieName(true)).toBe(secureSessionCookieName);
    expect(sessionCookieName(false)).toBe(plainSessionCookieName);
    const secure = sessionCookie("t".repeat(43), true, 2_592_000);
    expect(secure).toBe(
      `__Host-trail_session=${"t".repeat(43)}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    const plain = sessionCookie("t".repeat(43), false, 60);
    expect(plain).toBe(
      `trail_session=${"t".repeat(43)}; Max-Age=60; Path=/; HttpOnly; SameSite=Lax`,
    );
  });

  it("clears the cookie with an expired Max-Age", () => {
    expect(clearedSessionCookie(false)).toMatch(
      /^trail_session=; Max-Age=0; .*Expires=Thu, 01 Jan 1970/,
    );
  });
});

describe("userAgentLabel", () => {
  it("describes common browsers", () => {
    expect(
      userAgentLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      userAgentLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Mac");
    expect(
      userAgentLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      userAgentLabel("Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0"),
    ).toBe("Firefox on Linux");
    expect(userAgentLabel(null)).toBe("Unknown browser");
  });
});
