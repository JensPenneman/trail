import { describe, expect, it } from "vitest";
import { apiScopes } from "../src/apiScope";
import {
  apiTokenSecretPattern,
  apiTokenTemplates,
  createApiTokenRequestSchema,
  normaliseScopes,
  templateOfScopes,
  updateApiTokenRequestSchema,
} from "../src/apiToken";
import { ipNetworkProblem, ipNetworkSchema } from "../src/ipNetwork";

describe("API token templates", () => {
  it("map to the scopes the dialog offers", () => {
    expect(apiTokenTemplates["read-only"]).toEqual([
      "profile:read",
      "devices:read",
      "locations:read",
      "history:read",
      "people:read",
      "shares:read",
      "audit:read",
    ]);
    // An agent reads and corrects; who looked at the account is none of its business.
    expect(apiTokenTemplates.agent).toEqual([
      "profile:read",
      "devices:read",
      "locations:read",
      "locations:write",
      "history:read",
      "people:read",
      "shares:read",
    ]);
    expect(apiTokenTemplates.full).toEqual([...apiScopes]);
  });

  it("are recognised from a set of scopes in any order, else it is a set of one's own", () => {
    expect(templateOfScopes([...apiTokenTemplates["read-only"]].reverse())).toBe("read-only");
    expect(templateOfScopes(["locations:write", ...apiTokenTemplates.agent])).toBe("agent");
    expect(templateOfScopes(["locations:write", ...apiTokenTemplates["read-only"]])).toBeNull();
    expect(templateOfScopes([...apiScopes])).toBe("full");
    expect(templateOfScopes(["devices:read"])).toBeNull();
    expect(templateOfScopes([])).toBeNull();
  });

  it("put scopes in the vocabulary's order, each once", () => {
    expect(normaliseScopes(["history:read", "devices:read", "history:read"])).toEqual([
      "devices:read",
      "history:read",
    ]);
  });
});

describe("API token requests", () => {
  const base = { name: " Home Assistant ", scopes: ["devices:read"], expiresAt: null };

  it("trim the name, order the scopes and default to every device and address", () => {
    expect(
      createApiTokenRequestSchema.parse({
        ...base,
        scopes: ["locations:read", "devices:read", "locations:read"],
      }),
    ).toEqual({
      name: "Home Assistant",
      scopes: ["devices:read", "locations:read"],
      deviceIds: null,
      allowedIps: null,
      expiresAt: null,
    });
  });

  it("insist on a name, a scope and a stated expiry", () => {
    for (const body of [
      { ...base, name: "  " },
      { ...base, name: "x".repeat(61) },
      { ...base, scopes: [] },
      { ...base, scopes: ["devices:delete"] },
      { name: "x", scopes: ["devices:read"] },
      { ...base, expiresAt: "tomorrow" },
    ]) {
      expect(createApiTokenRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("take expiries with any offset", () => {
    const parsed = createApiTokenRequestSchema.parse({
      ...base,
      expiresAt: "2027-01-01T00:00:00+01:00",
    });
    expect(Date.parse(parsed.expiresAt ?? "")).toBe(Date.parse("2026-12-31T23:00:00Z"));
  });

  it("keep an empty device list (no device) apart from none (every device)", () => {
    const id = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
    expect(createApiTokenRequestSchema.parse({ ...base, deviceIds: [] }).deviceIds).toEqual([]);
    expect(createApiTokenRequestSchema.parse({ ...base, deviceIds: [id, id] }).deviceIds).toEqual([
      id,
    ]);
    expect(createApiTokenRequestSchema.safeParse({ ...base, deviceIds: ["phone"] }).success).toBe(
      false,
    );
  });

  it("need at least one network in an allowlist, and valid ones", () => {
    expect(createApiTokenRequestSchema.safeParse({ ...base, allowedIps: [] }).success).toBe(false);
    const parsed = createApiTokenRequestSchema.safeParse({
      ...base,
      allowedIps: [" 192.168.1.0/24", "192.168.1.7/24"],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["allowedIps", 1]);
    expect(parsed.error?.issues[0]?.message).toContain("the network is 192.168.1.0/24");
    expect(
      createApiTokenRequestSchema.parse({ ...base, allowedIps: [" 203.0.113.7 ", "2001:db8::/32"] })
        .allowedIps,
    ).toEqual(["203.0.113.7", "2001:db8::/32"]);
  });

  it("change at least one thing", () => {
    expect(updateApiTokenRequestSchema.safeParse({}).success).toBe(false);
    expect(updateApiTokenRequestSchema.parse({ expiresAt: null })).toEqual({ expiresAt: null });
  });

  it("describe secrets as trlk_ and 43 base64url characters", () => {
    expect(apiTokenSecretPattern.test(`trlk_${"a1_-".repeat(10)}abc`)).toBe(true);
    expect(apiTokenSecretPattern.test(`trlk_${"a".repeat(43)}\n`)).toBe(false);
  });
});

describe("IP networks", () => {
  it("accept addresses and networks in both families", () => {
    for (const network of [
      "203.0.113.7",
      "192.168.1.0/24",
      "0.0.0.0/0",
      "10.0.0.0/8",
      "2001:db8::/32",
      "::1",
      "::/0",
      "fe80::/10",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
      "1:2:3:4:5:6:7:8/128",
    ]) {
      expect(ipNetworkProblem(network), network).toBeNull();
    }
  });

  it("refuse what PostgreSQL would read differently or not at all", () => {
    for (const text of [
      "",
      "10/8",
      "192.168.1",
      "192.168.01.1",
      "256.1.1.1",
      "192.168.1.0/33",
      "192.168.1.0/",
      "192.168.1.0/024",
      "1.2.3.4/8/8",
      "2001:db8::/129",
      "1::2::3",
      ":::",
      "1:2:3:4:5:6:7:8:9",
      "fe80::1%en0",
      "example.com",
    ]) {
      expect(ipNetworkProblem(text), text).not.toBeNull();
    }
  });

  it("name the network when bits are set after the prefix", () => {
    expect(ipNetworkProblem("192.168.1.10/24")).toBe(
      "192.168.1.10/24 has bits set after the prefix: the network is 192.168.1.0/24",
    );
    expect(ipNetworkProblem("2001:db8::1/32")).toContain("the network is 2001:db8::/32");
    expect(ipNetworkProblem("2001:db8:0:1::/48")).toContain("the network is 2001:db8::/48");
    expect(ipNetworkProblem("10.1.2.3/0")).toContain("the network is 0.0.0.0/0");
  });

  it("want IPv4 networks written as IPv4", () => {
    expect(ipNetworkProblem("::ffff:192.0.2.0/120")).toBe(
      "::ffff:192.0.2.0/120 is an IPv4 network in IPv6 notation: write 192.0.2.0/24",
    );
    expect(ipNetworkProblem("::ffff:192.0.2.7")).toContain("write 192.0.2.7/32");
    // Wider IPv6 networks merely contain the mapped range; they stay IPv6 networks.
    expect(ipNetworkProblem("::/64")).toBeNull();
  });

  it("trim what is typed", () => {
    expect(ipNetworkSchema.parse("  192.168.1.0/24 ")).toBe("192.168.1.0/24");
  });
});
