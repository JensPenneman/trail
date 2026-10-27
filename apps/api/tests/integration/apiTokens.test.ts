import { apiPaths } from "@trail/contracts/apiPaths";
import { apiScopes } from "@trail/contracts/apiScope";
import {
  type ApiToken,
  apiTokenListResponseSchema,
  apiTokenResponseSchema,
  apiTokenWithSecretResponseSchema,
  type CreateApiTokenRequest,
  maxActiveApiTokens,
  maxStoredApiTokens,
  tokenVerificationSchema,
} from "@trail/contracts/apiToken";
import { devicePublicListResponseSchema } from "@trail/contracts/devicePublic";
import { apiErrorSchema } from "@trail/contracts/errors";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneExpiredData } from "../../src/jobs/pruneExpiredData";
import { bearer, createApiToken } from "../support/apiTokenFlows";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * The token store through the real app: management with the session
 * (/api/me/tokens) and verification on /api/v1, against the database.
 */
let t: TestContext;
const lines: string[] = [];
let owner: Agent;
let stranger: Agent;
let phone = "";
let watch = "";
let foreign = "";

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;
const invalidToken = 'Bearer realm="trail", error="invalid_token"';
const readOnly: CreateApiTokenRequest = {
  name: "Read-only",
  scopes: ["devices:read"],
  expiresAt: null,
};

/** `GET /api/v1/tokens/verify` with the secret, from `ip` when given (TRUST_PROXY is loopback). */
const verify = (secret: string, ip?: string) => {
  const call = request(t.app).get(apiPaths.v1.tokens.verify).set("Authorization", bearer(secret));
  return ip === undefined ? call : call.set("X-Forwarded-For", ip);
};

const listTokens = async (agent: Agent): Promise<ApiToken[]> =>
  apiTokenListResponseSchema.parse((await agent.get(apiPaths.me.tokens).expect(200)).body).tokens;

const tokenOf = async (agent: Agent, id: string): Promise<ApiToken | undefined> =>
  (await listTokens(agent)).find((token) => token.id === id);

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
  owner = agentFor(t.app);
  stranger = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
  phone = (await createDevice(owner, { name: "Phone" })).device.id;
  watch = (await createDevice(owner, { name: "Watch" })).device.id;
  foreign = (await createDevice(stranger, { name: "Stranger's phone" })).device.id;
});

afterAll(async () => {
  await t.close();
});

describe("creating a token", () => {
  it("shows the secret once and lists the token without it", async () => {
    const created = await owner
      .post(apiPaths.me.tokens)
      .set("Origin", testOrigin)
      .send({
        name: "  Home Assistant ",
        scopes: ["locations:read", "devices:read", "locations:read"],
        expiresAt: "2099-01-01T00:00:00+01:00",
      })
      .expect(201);
    const { token, secret } = apiTokenWithSecretResponseSchema.parse(created.body);
    expect(secret).toMatch(/^trlk_[A-Za-z0-9_-]{43}$/);
    expect(token).toMatchObject({
      name: "Home Assistant",
      hint: secret.slice(-4),
      scopes: ["devices:read", "locations:read"],
      deviceIds: null,
      allowedIps: null,
      expiresAt: "2098-12-31T23:00:00.000Z",
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
      status: "active",
    });
    expect(created.headers["cache-control"]).toBe("no-store");

    const listed = await owner.get(apiPaths.me.tokens).expect(200);
    expect(apiTokenListResponseSchema.parse(listed.body).tokens[0]).toEqual(token);
    expect(JSON.stringify(listed.body)).not.toContain(secret.slice(5));
    expect(JSON.stringify(listed.body)).not.toMatch(/hash/i);
  });

  it("works on /api/v1 at once, as the token's account and with its scopes", async () => {
    const { token, secret } = await createApiToken(owner, {
      ...readOnly,
      deviceIds: [watch],
    });
    const verified = await verify(secret).expect(200);
    expect(tokenVerificationSchema.parse(verified.body)).toEqual({
      id: token.id,
      name: "Read-only",
      scopes: ["devices:read"],
      deviceIds: [watch],
      expiresAt: null,
      status: "active",
    });
    const devices = await request(t.app)
      .get(apiPaths.v1.devices.root)
      .set("Authorization", bearer(secret))
      .expect(200);
    expect(devicePublicListResponseSchema.parse(devices.body).devices.map((d) => d.id)).toEqual([
      watch,
    ]);
    const refused = await request(t.app)
      .get(apiPaths.v1.me)
      .set("Authorization", bearer(secret))
      .expect(403);
    expect(errorOf(refused.body)).toMatchObject({ code: "insufficient_scope" });
  });

  it("can hold every scope there is", async () => {
    const { token } = await createApiToken(owner, {
      name: "Full access",
      scopes: [...apiScopes],
      expiresAt: null,
    });
    expect(token.scopes).toEqual([...apiScopes]);
  });

  it("validates names, scopes, addresses and the expiry", async () => {
    const post = (body: object) =>
      owner.post(apiPaths.me.tokens).set("Origin", testOrigin).send(body);
    for (const [body, field] of [
      [{ ...readOnly, name: " " }, "name"],
      [{ ...readOnly, scopes: [] }, "scopes"],
      [{ ...readOnly, scopes: ["devices:delete"] }, "scopes.0"],
      [{ name: "No expiry stated", scopes: ["devices:read"] }, "expiresAt"],
      [{ ...readOnly, expiresAt: "2020-01-01T00:00:00Z" }, "expiresAt"],
      [{ ...readOnly, allowedIps: [] }, "allowedIps"],
      [{ ...readOnly, allowedIps: ["192.168.1.10/24"] }, "allowedIps.0"],
      [{ ...readOnly, allowedIps: ["10/8"] }, "allowedIps.0"],
      [{ ...readOnly, deviceIds: ["phone"] }, "deviceIds.0"],
    ] as const) {
      const response = await post(body).expect(400);
      const error = errorOf(response.body);
      expect(error.code, JSON.stringify(body)).toBe("validation_failed");
      expect(Object.keys(error.fields ?? {}), JSON.stringify(body)).toContain(field);
    }
  });

  it("only for the account's own devices", async () => {
    for (const deviceIds of [
      [foreign],
      [phone, foreign],
      ["0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"],
    ]) {
      const response = await owner
        .post(apiPaths.me.tokens)
        .set("Origin", testOrigin)
        .send({ ...readOnly, deviceIds })
        .expect(404);
      expect(errorOf(response.body).code).toBe("not_found");
    }
  });

  it("stores the allowlist as networks", async () => {
    const { token } = await createApiToken(owner, {
      ...readOnly,
      allowedIps: ["203.0.113.7", "2001:DB8::/32", "203.0.113.7"],
    });
    expect(token.allowedIps).toEqual(["203.0.113.7/32", "2001:db8::/32"]);
  });
});

describe("managing tokens takes the signed-in session", () => {
  it("never a token, which /api/me/tokens does not even read", async () => {
    const { token, secret } = await createApiToken(owner, readOnly);
    const asToken = (call: request.Test) =>
      call.set("Authorization", bearer(secret)).set("Origin", testOrigin);
    await asToken(request(t.app).get(apiPaths.me.tokens)).expect(401);
    await asToken(request(t.app).post(apiPaths.me.tokens)).send(readOnly).expect(401);
    await asToken(request(t.app).post(apiPaths.me.rollToken(token.id))).expect(401);
    await asToken(request(t.app).delete(apiPaths.me.token(token.id))).expect(401);
    // And the public API has no way to manage them.
    for (const call of [
      request(t.app).post("/api/v1/tokens").send(readOnly),
      request(t.app).delete(`/api/v1/tokens/${token.id}`),
      request(t.app).post(`/api/v1/tokens/${token.id}/roll`),
    ]) {
      const response = await call.set("Authorization", bearer(secret)).expect(404);
      expect(errorOf(response.body).message).toBe("No such API route.");
    }
    expect((await tokenOf(owner, token.id))?.status).toBe("active");
  });

  it("and the CSRF guard for every change", async () => {
    const { token } = await createApiToken(owner, readOnly);
    for (const call of [
      owner.post(apiPaths.me.tokens).send(readOnly),
      owner.post(apiPaths.me.tokens).set("Origin", "https://evil.example").send(readOnly),
      owner
        .patch(apiPaths.me.token(token.id))
        .set("Origin", "https://evil.example")
        .send({ name: "x" }),
      owner.post(apiPaths.me.rollToken(token.id)).set("Origin", "https://evil.example"),
      owner.delete(apiPaths.me.token(token.id)).set("Origin", "https://evil.example"),
      owner
        .delete(apiPaths.me.token(token.id))
        .set("Origin", testOrigin)
        .set("Sec-Fetch-Site", "cross-site"),
    ]) {
      const response = await call.expect(403);
      expect(errorOf(response.body).code).toBe("origin_not_allowed");
    }
    expect(await tokenOf(owner, token.id)).toMatchObject({ name: "Read-only", status: "active" });
  });

  it("of the token's owner: other people's tokens do not exist", async () => {
    const { token, secret } = await createApiToken(owner, readOnly);
    expect((await listTokens(stranger)).map((listed) => listed.id)).not.toContain(token.id);
    for (const call of [
      stranger.patch(apiPaths.me.token(token.id)).send({ name: "Mine now" }),
      stranger.post(apiPaths.me.rollToken(token.id)),
      stranger.delete(apiPaths.me.token(token.id)),
      owner.patch(apiPaths.me.token("not-a-uuid")).send({ name: "x" }),
      owner.post(apiPaths.me.rollToken("0199a0f3-5fec-72ad-a30c-5ab9d8908cd3")),
      owner.delete(apiPaths.me.token("not-a-uuid")),
    ]) {
      const response = await call.set("Origin", testOrigin).expect(404);
      expect(errorOf(response.body).code).toBe("not_found");
    }
    await verify(secret).expect(200);
  });
});

describe("changing a token", () => {
  it("changes its settings and keeps the secret working", async () => {
    const { token, secret } = await createApiToken(owner, readOnly);
    const response = await owner
      .patch(apiPaths.me.token(token.id))
      .set("Origin", testOrigin)
      .send({
        name: "Dashboard widget",
        scopes: ["history:read", "devices:read"],
        deviceIds: [phone],
        allowedIps: ["127.0.0.1"],
        expiresAt: "2099-06-01T00:00:00Z",
      })
      .expect(200);
    expect(apiTokenResponseSchema.parse(response.body).token).toMatchObject({
      id: token.id,
      hint: token.hint,
      name: "Dashboard widget",
      scopes: ["devices:read", "history:read"],
      deviceIds: [phone],
      allowedIps: ["127.0.0.1/32"],
      expiresAt: "2099-06-01T00:00:00.000Z",
      status: "active",
    });
    const verified = tokenVerificationSchema.parse((await verify(secret).expect(200)).body);
    expect(verified).toMatchObject({ name: "Dashboard widget", deviceIds: [phone] });

    const back = await owner
      .patch(apiPaths.me.token(token.id))
      .set("Origin", testOrigin)
      .send({ deviceIds: null, allowedIps: null, expiresAt: null })
      .expect(200);
    expect(apiTokenResponseSchema.parse(back.body).token).toMatchObject({
      deviceIds: null,
      allowedIps: null,
      expiresAt: null,
    });
  });

  it("validates like creating one", async () => {
    const { token } = await createApiToken(owner, readOnly);
    const patch = (body: object) =>
      owner.patch(apiPaths.me.token(token.id)).set("Origin", testOrigin).send(body);
    for (const body of [{}, { scopes: [] }, { expiresAt: "2001-01-01T00:00:00Z" }]) {
      expect(errorOf((await patch(body).expect(400)).body).code).toBe("validation_failed");
    }
    await patch({ deviceIds: [foreign] }).expect(404);
    expect((await tokenOf(owner, token.id))?.deviceIds).toBeNull();
  });
});

describe("rolling a token", () => {
  it("keeps the row and its settings, and the old secret stops working at once", async () => {
    const { token, secret } = await createApiToken(owner, {
      ...readOnly,
      deviceIds: [phone],
    });
    await verify(secret).expect(200);
    const rolled = await owner
      .post(apiPaths.me.rollToken(token.id))
      .set("Origin", testOrigin)
      .expect(200);
    const fresh = apiTokenWithSecretResponseSchema.parse(rolled.body);
    expect(fresh.secret).not.toBe(secret);
    expect(fresh.token).toMatchObject({
      id: token.id,
      name: token.name,
      scopes: token.scopes,
      deviceIds: [phone],
      createdAt: token.createdAt,
      hint: fresh.secret.slice(-4),
      status: "active",
    });

    const old = await verify(secret).expect(401);
    expect(errorOf(old.body).code).toBe("unauthorized");
    expect(old.headers["www-authenticate"]).toBe(invalidToken);
    expect(tokenVerificationSchema.parse((await verify(fresh.secret).expect(200)).body).id).toBe(
      token.id,
    );
  });
});

describe("revoking a token", () => {
  it("refuses its secret at once and keeps it listed as revoked", async () => {
    const { token, secret } = await createApiToken(owner, readOnly);
    await verify(secret).expect(200);
    await owner.delete(apiPaths.me.token(token.id)).set("Origin", testOrigin).expect(204);

    const refused = await verify(secret).expect(401);
    expect(errorOf(refused.body).code).toBe("unauthorized");
    expect(refused.headers["www-authenticate"]).toBe(invalidToken);
    const listed = await tokenOf(owner, token.id);
    expect(listed).toMatchObject({ status: "revoked" });
    expect(listed?.revokedAt).not.toBeNull();

    // Revoking twice is harmless; a revoked token can be neither changed nor rolled.
    await owner.delete(apiPaths.me.token(token.id)).set("Origin", testOrigin).expect(204);
    for (const call of [
      owner.patch(apiPaths.me.token(token.id)).send({ name: "Back" }),
      owner.post(apiPaths.me.rollToken(token.id)),
    ]) {
      expect(errorOf((await call.set("Origin", testOrigin).expect(409)).body).code).toBe(
        "conflict",
      );
    }
    expect((await tokenOf(owner, token.id))?.revokedAt).toBe(listed?.revokedAt);
  });
});

describe("expired tokens", () => {
  it("answer 401 token_expired, and can only be revoked", async () => {
    const { token, secret } = await createApiToken(owner, readOnly);
    await t.ctx.db.execute(
      sql`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = ${token.id}`,
    );
    const refused = await verify(secret).expect(401);
    expect(errorOf(refused.body).code).toBe("token_expired");
    expect(refused.headers["www-authenticate"]).toBe(invalidToken);
    expect((await tokenOf(owner, token.id))?.status).toBe("expired");
    for (const call of [
      owner.patch(apiPaths.me.token(token.id)).send({ expiresAt: "2099-01-01T00:00:00Z" }),
      owner.post(apiPaths.me.rollToken(token.id)),
    ]) {
      await call.set("Origin", testOrigin).expect(409);
    }
    await owner.delete(apiPaths.me.token(token.id)).set("Origin", testOrigin).expect(204);
    expect((await tokenOf(owner, token.id))?.status).toBe("revoked");
  });
});

describe("address allowlists", () => {
  it("let the token in from its networks only", async () => {
    const { secret } = await createApiToken(owner, {
      ...readOnly,
      allowedIps: ["203.0.113.0/24", "2001:db8::/32"],
    });
    await verify(secret, "203.0.113.9").expect(200);
    await verify(secret, "2001:db8:a::1").expect(200);
    for (const ip of ["198.51.100.1", "2001:db9::1", undefined]) {
      const refused = await verify(secret, ip).expect(401);
      expect(errorOf(refused.body).code, ip).toBe("unauthorized");
      expect(refused.headers["www-authenticate"]).toBe(invalidToken);
    }
  });

  it("tell a caller from elsewhere nothing, not even that the token expired", async () => {
    const { token, secret } = await createApiToken(owner, {
      ...readOnly,
      allowedIps: ["203.0.113.0/24"],
    });
    await t.ctx.db.execute(
      sql`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = ${token.id}`,
    );
    expect(errorOf((await verify(secret, "198.51.100.1").expect(401)).body).code).toBe(
      "unauthorized",
    );
    expect(errorOf((await verify(secret, "203.0.113.9").expect(401)).body).code).toBe(
      "token_expired",
    );
  });
});

describe("last use", () => {
  it("is recorded after the request, at most once a minute", async () => {
    const { token, secret } = await createApiToken(owner, readOnly);
    expect(token.lastUsedAt).toBeNull();
    await verify(secret, "203.0.113.20").expect(200);
    await t.ctx.background.drain(5_000);
    const first = await tokenOf(owner, token.id);
    expect(first?.lastUsedAt).not.toBeNull();
    expect(first?.lastUsedIp).toBe("203.0.113.20");

    // Within the minute nothing is written, from wherever the token is used.
    await verify(secret, "203.0.113.21").expect(200);
    await verify(secret, "203.0.113.22").expect(200);
    await t.ctx.background.drain(5_000);
    expect(await tokenOf(owner, token.id)).toMatchObject({
      lastUsedAt: first?.lastUsedAt,
      lastUsedIp: "203.0.113.20",
    });

    // A minute later the next request is recorded again; a burst of them writes once.
    await t.ctx.db.execute(
      sql`UPDATE api_tokens SET last_used_at = now() - interval '2 minutes' WHERE id = ${token.id}`,
    );
    const backdated = (await tokenOf(owner, token.id))?.lastUsedAt ?? "";
    await Promise.all(
      ["203.0.113.30", "203.0.113.30", "203.0.113.30"].map((ip) => verify(secret, ip).expect(200)),
    );
    await t.ctx.background.drain(5_000);
    const again = await tokenOf(owner, token.id);
    expect(Date.parse(again?.lastUsedAt ?? "")).toBeGreaterThan(Date.parse(backdated));
    expect(again?.lastUsedIp).toBe("203.0.113.30");
  });
});

describe("deleting a device", () => {
  it("takes it out of every token, and an emptied list means no device at all", async () => {
    const extra = (await createDevice(owner, { name: "Spare" })).device.id;
    const onlyExtra = await createApiToken(owner, { ...readOnly, deviceIds: [extra] });
    const both = await createApiToken(owner, { ...readOnly, deviceIds: [phone, extra] });
    const all = await createApiToken(owner, readOnly);
    await owner.delete(apiPaths.devices.one(extra)).set("Origin", testOrigin).expect(204);

    expect((await tokenOf(owner, onlyExtra.token.id))?.deviceIds).toEqual([]);
    expect((await tokenOf(owner, both.token.id))?.deviceIds).toEqual([phone]);
    expect((await tokenOf(owner, all.token.id))?.deviceIds).toBeNull();

    const none = await request(t.app)
      .get(apiPaths.v1.devices.root)
      .set("Authorization", bearer(onlyExtra.secret))
      .expect(200);
    expect(none.body).toEqual({ devices: [] });
    await request(t.app)
      .get(apiPaths.v1.devices.one(phone))
      .set("Authorization", bearer(onlyExtra.secret))
      .expect(404);
  });
});

describe("the limit of active tokens", () => {
  it(`is ${maxActiveApiTokens} per account; revoked and expired ones make room`, async () => {
    const capped = agentFor(t.app);
    await signUp(capped, new SoftwareAuthenticator(), "capped@allowed.test");
    const created: string[] = [];
    for (let index = 0; index < maxActiveApiTokens; index += 1) {
      created.push(
        (await createApiToken(capped, { ...readOnly, name: `Token ${index}` })).token.id,
      );
    }
    const refused = await capped
      .post(apiPaths.me.tokens)
      .set("Origin", testOrigin)
      .send(readOnly)
      .expect(409);
    expect(errorOf(refused.body).code).toBe("conflict");

    await capped
      .delete(apiPaths.me.token(created[0] ?? ""))
      .set("Origin", testOrigin)
      .expect(204);
    await createApiToken(capped, readOnly);
    await capped.post(apiPaths.me.tokens).set("Origin", testOrigin).send(readOnly).expect(409);

    // One place left after an expiry: of two parallel requests, exactly one gets it.
    await t.ctx.db.execute(
      sql`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = ${created[1] ?? ""}`,
    );
    const racing = await Promise.all(
      [1, 2].map(() => capped.post(apiPaths.me.tokens).set("Origin", testOrigin).send(readOnly)),
    );
    expect(racing.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await listTokens(capped)).filter((token) => token.status === "active")).toHaveLength(
      maxActiveApiTokens,
    );

    // Revoked and expired tokens are kept a while, but not without bound: the list stays bounded.
    await t.ctx.db.execute(sql`
      INSERT INTO api_tokens (user_id, name, token_hash, token_hint, scopes, revoked_at)
      SELECT user_id, 'Revoked ' || n, 'stored-cap-' || n, 'abcd', ARRAY['devices:read'], now()
      FROM api_tokens, generate_series(1, ${maxStoredApiTokens - maxActiveApiTokens - 2}) AS n
      WHERE id = ${created[0] ?? ""}
    `);
    expect(await listTokens(capped)).toHaveLength(maxStoredApiTokens);
    await capped
      .delete(apiPaths.me.token(created[2] ?? ""))
      .set("Origin", testOrigin)
      .expect(204);
    const stored = await capped
      .post(apiPaths.me.tokens)
      .set("Origin", testOrigin)
      .send(readOnly)
      .expect(409);
    expect(errorOf(stored.body).message).toContain(`${maxStoredApiTokens} API tokens`);
  });
});

describe("pruning", () => {
  it("removes tokens 30 days after they were revoked or expired, not before", async () => {
    const pruner = agentFor(t.app);
    await signUp(pruner, new SoftwareAuthenticator(), "pruner@allowed.test");
    const ids = await Promise.all(
      ["revoked long ago", "expired long ago", "revoked lately", "active"].map(
        async (name) => (await createApiToken(pruner, { ...readOnly, name })).token.id,
      ),
    );
    const [revokedLongAgo = "", expiredLongAgo = "", revokedLately = "", active = ""] = ids;
    await t.ctx.db.execute(sql`
      UPDATE api_tokens SET revoked_at = now() - interval '31 days' WHERE id = ${revokedLongAgo}
    `);
    await t.ctx.db.execute(sql`
      UPDATE api_tokens SET expires_at = now() - interval '31 days' WHERE id = ${expiredLongAgo}
    `);
    await t.ctx.db.execute(sql`
      UPDATE api_tokens SET revoked_at = now() - interval '29 days' WHERE id = ${revokedLately}
    `);
    const pruned = await pruneExpiredData(t.ctx.db, t.ctx.config);
    expect(pruned.apiTokens).toBe(2);
    expect((await listTokens(pruner)).map((token) => token.id).sort()).toEqual(
      [revokedLately, active].sort(),
    );
  });
});

describe("deleting the account", () => {
  it("takes its tokens along", async () => {
    const leaving = agentFor(t.app);
    await signUp(leaving, new SoftwareAuthenticator(), "leaving@allowed.test");
    const { secret } = await createApiToken(leaving, readOnly);
    await verify(secret).expect(200);
    await leaving
      .delete(apiPaths.me.root)
      .set("Origin", testOrigin)
      .send({ confirmEmail: "leaving@allowed.test" })
      .expect(204);
    expect(errorOf((await verify(secret).expect(401)).body).code).toBe("unauthorized");
  });
});

describe("the audit log", () => {
  it("records creating, changing, rolling and revoking with ids, never a secret", async () => {
    lines.length = 0;
    const { token, secret } = await createApiToken(owner, readOnly);
    await owner
      .patch(apiPaths.me.token(token.id))
      .set("Origin", testOrigin)
      .send({ name: "Renamed" })
      .expect(200);
    const rolled = apiTokenWithSecretResponseSchema.parse(
      (await owner.post(apiPaths.me.rollToken(token.id)).set("Origin", testOrigin).expect(200))
        .body,
    );
    await verify(rolled.secret).expect(200);
    await owner.delete(apiPaths.me.token(token.id)).set("Origin", testOrigin).expect(204);
    await new Promise((resolve) => setImmediate(resolve));

    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const audit = entries.filter((entry) => String(entry["msg"]).startsWith("API token "));
    expect(audit.map((entry) => entry["msg"])).toEqual([
      "API token created",
      "API token changed",
      "API token rolled",
      "API token revoked",
    ]);
    for (const entry of audit) {
      expect(entry).toMatchObject({ level: 30, tokenId: token.id });
      expect(entry["userId"]).toEqual(expect.any(String));
    }
    const everything = lines.join("\n");
    expect(everything).not.toContain(secret.slice(5));
    expect(everything).not.toContain(rolled.secret.slice(5));
  });
});
