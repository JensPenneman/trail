import { apiTokenSecretPattern } from "@trail/contracts/apiToken";
import { describe, expect, it } from "vitest";
import { addressAllowed } from "../../src/apiTokens/addressAllowed";
import { apiTokenStatus } from "../../src/apiTokens/apiTokenStatus";
import { clientAddress } from "../../src/apiTokens/clientAddress";
import { futureExpiry } from "../../src/apiTokens/futureExpiry";
import { generateApiTokenSecret } from "../../src/apiTokens/generateApiTokenSecret";
import { HttpError } from "../../src/http/httpError";
import { hashToken } from "../../src/lib/hashToken";
import { apiTokenPattern } from "../../src/v1/apiTokens";

describe("API token secrets", () => {
  it("are trlk_ and 32 random bytes, stored only as their hash", () => {
    const { secret, hash, hint } = generateApiTokenSecret();
    expect(secret).toMatch(/^trlk_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret.slice(5), "base64url")).toHaveLength(32);
    expect(hash).toBe(hashToken(secret));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hint).toBe(secret.slice(-4));
    expect(generateApiTokenSecret().secret).not.toBe(secret);
  });

  it("have one shape, from the contract, wherever they are checked", () => {
    expect(apiTokenPattern).toBe(apiTokenSecretPattern);
    expect(apiTokenPattern.test(generateApiTokenSecret().secret)).toBe(true);
    for (const wrong of [
      `trl_${"A".repeat(43)}`,
      `trlk_${"A".repeat(42)}`,
      `trlk_${"A".repeat(44)}`,
      `trlk_${"A".repeat(42)}=`,
      `TRLK_${"A".repeat(43)}`,
    ]) {
      expect(apiTokenPattern.test(wrong), wrong).toBe(false);
    }
  });
});

describe("API token status", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");

  it("is active until revoked or expired, and revoked wins", () => {
    expect(apiTokenStatus({ revokedAt: null, expiresAt: null }, now)).toBe("active");
    expect(
      apiTokenStatus({ revokedAt: null, expiresAt: new Date("2026-10-26T12:00:01Z") }, now),
    ).toBe("active");
    expect(
      apiTokenStatus({ revokedAt: null, expiresAt: new Date("2026-10-26T12:00:00Z") }, now),
    ).toBe("expired");
    expect(
      apiTokenStatus(
        {
          revokedAt: new Date("2026-10-20T00:00:00Z"),
          expiresAt: new Date("2026-10-21T00:00:00Z"),
        },
        now,
      ),
    ).toBe("revoked");
  });

  it("needs an expiry in the future, when there is one", () => {
    expect(futureExpiry(null, now)).toBeNull();
    expect(futureExpiry("2026-10-26T14:30:00+02:00", now)?.toISOString()).toBe(
      "2026-10-26T12:30:00.000Z",
    );
    expect(futureExpiry("2026-10-27T00:00:00Z", now)?.toISOString()).toBe(
      "2026-10-27T00:00:00.000Z",
    );
    for (const past of ["2026-10-26T14:00:00+02:00", "2026-01-01T00:00:00Z"]) {
      let error: unknown;
      try {
        futureExpiry(past, now);
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 400, code: "validation_failed" });
      expect((error as HttpError).fields).toHaveProperty("expiresAt");
    }
  });
});

describe("address allowlists", () => {
  it("match IPv4 and IPv6 networks and single addresses", () => {
    const networks = ["192.168.1.0/24", "203.0.113.7/32", "2001:db8::/32"];
    expect(addressAllowed("192.168.1.200", networks)).toBe(true);
    expect(addressAllowed("192.168.2.1", networks)).toBe(false);
    expect(addressAllowed("203.0.113.7", networks)).toBe(true);
    expect(addressAllowed("203.0.113.8", networks)).toBe(false);
    expect(addressAllowed("2001:db8:1::5", networks)).toBe(true);
    expect(addressAllowed("2001:db9::1", networks)).toBe(false);
    expect(addressAllowed("0.0.0.1", ["0.0.0.0/0"])).toBe(true);
    expect(addressAllowed("::1", ["::/0"])).toBe(true);
  });

  it("match an address against networks of its own family only", () => {
    expect(addressAllowed("203.0.113.9", ["::/0"])).toBe(false);
    expect(addressAllowed("203.0.113.9", ["::/0", "203.0.113.0/24"])).toBe(true);
    expect(addressAllowed("2001:db8::1", ["0.0.0.0/0"])).toBe(false);
  });

  it("never allow an unknown address", () => {
    expect(addressAllowed(null, ["0.0.0.0/0", "::/0"])).toBe(false);
  });

  it("take the client address as IPv4 even from a dual-stack socket", () => {
    expect(clientAddress("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientAddress("::FFFF:192.168.1.4")).toBe("192.168.1.4");
    expect(addressAllowed(clientAddress("::ffff:192.168.1.4"), ["192.168.1.0/24"])).toBe(true);
    expect(clientAddress("2001:db8::1")).toBe("2001:db8::1");
    expect(clientAddress("fe80::1%en0")).toBe("fe80::1");
    expect(clientAddress("127.0.0.1")).toBe("127.0.0.1");
  });

  it("refuse what is not an address, so it never reaches the database as one", () => {
    expect(clientAddress(undefined)).toBeNull();
    expect(clientAddress(null)).toBeNull();
    expect(clientAddress("garbage")).toBeNull();
    expect(clientAddress("203.0.113.9, 10.0.0.1")).toBeNull();
    expect(clientAddress("::ffff:999.1.1.1")).toBeNull();
  });
});
