import { adminUserListResponseSchema } from "@trail/contracts/adminUser";
import {
  linkInfoResponseSchema,
  linkStartResponseSchema,
  startAuthResponseSchema,
} from "@trail/contracts/auth";
import { apiErrorSchema } from "@trail/contracts/errors";
import { createInviteResponseSchema, inviteListResponseSchema } from "@trail/contracts/invite";
import {
  addPasskeyOptionsResponseSchema,
  addPasskeyResponseSchema,
  passkeyListResponseSchema,
} from "@trail/contracts/passkey";
import { createPasskeyLinkResponseSchema } from "@trail/contracts/passkeyLink";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signIn, signUp } from "../support/authFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { otherOrigin, testOrigin } from "../support/testEnvironment";

let t: TestContext;
let admin: Agent;
const adminKeys = new SoftwareAuthenticator();

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  admin = agentFor(t.app);
  await signUp(admin, adminKeys, "first@example.com");
});

afterAll(async () => {
  await t.close();
});

const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;
const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

describe("passkeys of the signed-in user", () => {
  const secondKey = new SoftwareAuthenticator({
    aaguid: "00000000-0000-0000-0000-000000000000",
    synced: false,
  });
  let secondId = "";

  it("lists passkeys with provider, sync state and whether they work here", async () => {
    const response = await admin.get("/api/me/passkeys").set("Origin", testOrigin).expect(200);
    const { passkeys } = passkeyListResponseSchema.parse(response.body);
    expect(passkeys).toHaveLength(1);
    expect(passkeys[0]).toMatchObject({
      name: "iCloud Keychain",
      provider: "iCloud Keychain",
      rpId: "localhost",
      usableHere: true,
      backedUp: true,
      deviceType: "multiDevice",
      transports: ["internal", "hybrid"],
    });
  });

  it("adds a passkey (existing ones excluded) with a chosen name", async () => {
    const optionsResponse = await admin
      .post("/api/me/passkeys/options")
      .set("Origin", testOrigin)
      .expect(200);
    const { ceremonyId, options } = addPasskeyOptionsResponseSchema.parse(optionsResponse.body);
    expect(options.excludeCredentials?.map((credential) => credential.id)).toEqual([
      adminKeys.credentials[0]?.id.toString("base64url"),
    ]);
    const added = await admin
      .post("/api/me/passkeys")
      .set("Origin", testOrigin)
      .send({
        ceremonyId,
        response: secondKey.createCredential(options, testOrigin),
        name: "YubiKey",
      })
      .expect(201);
    const { passkey } = addPasskeyResponseSchema.parse(added.body);
    expect(passkey).toMatchObject({
      name: "YubiKey",
      provider: null,
      backedUp: false,
      deviceType: "singleDevice",
    });
    secondId = passkey.id;
  });

  it("renames a passkey", async () => {
    const renamed = await admin
      .patch(`/api/me/passkeys/${encodeURIComponent(secondId)}`)
      .set("Origin", testOrigin)
      .send({ name: "Security key" })
      .expect(200);
    expect(addPasskeyResponseSchema.parse(renamed.body).passkey.name).toBe("Security key");
  });

  it("deletes a passkey but never the last one", async () => {
    await admin
      .delete(`/api/me/passkeys/${encodeURIComponent(secondId)}`)
      .set("Origin", testOrigin)
      .expect(204);
    const lastId = adminKeys.credentials[0]?.id.toString("base64url") ?? "";
    const refused = await admin
      .delete(`/api/me/passkeys/${encodeURIComponent(lastId)}`)
      .set("Origin", testOrigin)
      .expect(409);
    expect(errorCode(refused.body)).toBe("last_passkey");
  });

  it("does not reveal other people's passkeys", async () => {
    const other = agentFor(t.app);
    await signUp(other, new SoftwareAuthenticator(), "other@allowed.test");
    const lastId = adminKeys.credentials[0]?.id.toString("base64url") ?? "";
    await other
      .patch(`/api/me/passkeys/${encodeURIComponent(lastId)}`)
      .set("Origin", testOrigin)
      .send({ name: "mine now" })
      .expect(404);
    await other
      .delete(`/api/me/passkeys/${encodeURIComponent(lastId)}`)
      .set("Origin", testOrigin)
      .expect(404);
  });
});

describe("passkey links", () => {
  const phoneKeys = new SoftwareAuthenticator();

  it("adds a passkey on another allowed origin (its own RP ID)", async () => {
    const created = await admin
      .post("/api/me/passkey-links")
      .set("Origin", testOrigin)
      .send({ origin: otherOrigin })
      .expect(201);
    const link = createPasskeyLinkResponseSchema.parse(created.body);
    expect(link.url.startsWith(`${otherOrigin}/link/`)).toBe(true);
    const token = tokenOf(link.url);

    const info = await agentFor(t.app).get(`/api/auth/link/${token}`).expect(200);
    expect(linkInfoResponseSchema.parse(info.body)).toMatchObject({
      kind: "passkey",
      email: "first@example.com",
    });

    const wrongOrigin = await agentFor(t.app)
      .post(`/api/auth/link/${token}/start`)
      .set("Origin", testOrigin)
      .expect(403);
    expect(errorCode(wrongOrigin.body)).toBe("origin_not_allowed");

    const phone = agentFor(t.app);
    const started = await phone
      .post(`/api/auth/link/${token}/start`)
      .set("Origin", otherOrigin)
      .expect(200);
    const start = linkStartResponseSchema.parse(started.body);
    expect(start.options.rp.id).toBe("trail.localhost");
    const finished = await phone
      .post("/api/auth/finish")
      .set("Origin", otherOrigin)
      .send({
        ceremonyId: start.ceremonyId,
        response: phoneKeys.createCredential(start.options, otherOrigin),
      })
      .expect(200);
    expect(finished.body).toMatchObject({ created: false, user: { email: "first@example.com" } });

    // The link is used up.
    const used = await agentFor(t.app).get(`/api/auth/link/${token}`).expect(404);
    expect(errorCode(used.body)).toBe("link_invalid");
    await agentFor(t.app)
      .post(`/api/auth/link/${token}/start`)
      .set("Origin", otherOrigin)
      .expect(404);

    // One account, passkeys for both RP IDs; each origin sees which ones work there.
    const listed = await admin.get("/api/me/passkeys").set("Origin", otherOrigin).expect(200);
    const usable = passkeyListResponseSchema
      .parse(listed.body)
      .passkeys.map((passkey) => [passkey.rpId, passkey.usableHere]);
    expect(usable).toEqual([
      ["localhost", false],
      ["trail.localhost", true],
    ]);
    await signIn(agentFor(t.app), phoneKeys, "first@example.com", otherOrigin);
  });

  it("only makes links for the server's own origins", async () => {
    const refused = await admin
      .post("/api/me/passkey-links")
      .set("Origin", testOrigin)
      .send({ origin: "https://evil.example" })
      .expect(400);
    expect(apiErrorSchema.parse(refused.body).error.fields).toHaveProperty("origin");
    const defaulted = await admin
      .post("/api/me/passkey-links")
      .set("Origin", testOrigin)
      .send({})
      .expect(201);
    expect(
      createPasskeyLinkResponseSchema.parse(defaulted.body).url.startsWith(`${testOrigin}/link/`),
    ).toBe(true);
  });

  it("answers link_invalid for unknown or malformed tokens", async () => {
    await agentFor(t.app)
      .get(`/api/auth/link/${"x".repeat(43)}`)
      .expect(404);
    const malformed = await agentFor(t.app).get("/api/auth/link/bad!").expect(404);
    expect(errorCode(malformed.body)).toBe("link_invalid");
  });
});

describe("invites", () => {
  it("binds an invite to one address when given", async () => {
    const created = await admin
      .post("/api/admin/invites")
      .set("Origin", testOrigin)
      .send({ email: "Friend@Elsewhere.test", expiresInDays: 3 })
      .expect(201);
    const { invite, url } = createInviteResponseSchema.parse(created.body);
    expect(invite.email).toBe("friend@elsewhere.test");
    expect(url.startsWith(`${testOrigin}/invite/`)).toBe(true);
    const inviteToken = tokenOf(url);

    const info = await agentFor(t.app).get(`/api/auth/link/${inviteToken}`).expect(200);
    expect(linkInfoResponseSchema.parse(info.body)).toMatchObject({
      kind: "invite",
      email: "friend@elsewhere.test",
    });

    const wrongAddress = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "someone@elsewhere.test", inviteToken })
      .expect(403);
    expect(errorCode(wrongAddress.body)).toBe("signup_not_allowed");

    const result = await signUp(
      agentFor(t.app),
      new SoftwareAuthenticator(),
      "friend@elsewhere.test",
      {
        inviteToken,
      },
    );
    expect(result).toMatchObject({ created: true, user: { isAdmin: false } });

    const reused = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "another@elsewhere.test", inviteToken })
      .expect(403);
    expect(errorCode(reused.body)).toBe("signup_not_allowed");

    const listed = await admin.get("/api/admin/invites").expect(200);
    const stored = inviteListResponseSchema
      .parse(listed.body)
      .invites.find((item) => item.id === invite.id);
    expect(stored?.usedByEmail).toBe("friend@elsewhere.test");
    expect(stored?.usedAt).not.toBeNull();
  });

  it("lets anyone use an open invite once", async () => {
    const created = await admin
      .post("/api/admin/invites")
      .set("Origin", testOrigin)
      .send({})
      .expect(201);
    const { invite, url } = createInviteResponseSchema.parse(created.body);
    expect(invite.email).toBeNull();
    const inviteToken = tokenOf(url);
    const result = await signUp(agentFor(t.app), new SoftwareAuthenticator(), "open@invited.test", {
      inviteToken,
    });
    expect(result.created).toBe(true);
    const second = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "second@invited.test", inviteToken })
      .expect(403);
    expect(errorCode(second.body)).toBe("signup_not_allowed");
  });

  it("revokes invites", async () => {
    const created = await admin
      .post("/api/admin/invites")
      .set("Origin", testOrigin)
      .send({})
      .expect(201);
    const { invite, url } = createInviteResponseSchema.parse(created.body);
    await admin.delete(`/api/admin/invites/${invite.id}`).set("Origin", testOrigin).expect(204);
    await agentFor(t.app)
      .get(`/api/auth/link/${tokenOf(url)}`)
      .expect(404);
    await admin.delete(`/api/admin/invites/${invite.id}`).set("Origin", testOrigin).expect(404);
    await admin.delete("/api/admin/invites/not-a-uuid").set("Origin", testOrigin).expect(404);
  });

  it("reports the invite, not the allow-list, when a token is wrong", async () => {
    const response = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "nobody@elsewhere.test", inviteToken: "y".repeat(43) })
      .expect(403);
    expect(apiErrorSchema.parse(response.body).error.message).toContain("invite");
  });
});

describe("administration", () => {
  it("lists users with their device and passkey counts", async () => {
    const response = await admin.get("/api/admin/users").expect(200);
    const { users } = adminUserListResponseSchema.parse(response.body);
    expect(users.map((user) => user.email)).toEqual([
      "first@example.com",
      "other@allowed.test",
      "friend@elsewhere.test",
      "open@invited.test",
    ]);
    expect(users[0]).toMatchObject({ isAdmin: true, passkeys: 2, devices: 0 });
    expect(users[0]?.lastSeenAt).not.toBeNull();
  });

  it("is only for administrators", async () => {
    const member = agentFor(t.app);
    await signUp(member, new SoftwareAuthenticator(), "member@allowed.test");
    const forbidden = await member.get("/api/admin/users").expect(403);
    expect(errorCode(forbidden.body)).toBe("forbidden");
    await member.get("/api/admin/invites").expect(403);
    await member.post("/api/admin/invites").set("Origin", testOrigin).send({}).expect(403);
    await agentFor(t.app).get("/api/admin/users").expect(401);
  });

  it("offers the registration flow for invited addresses only with a valid invite", async () => {
    const started = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "late@allowed.test" })
      .expect(200);
    expect(startAuthResponseSchema.parse(started.body).flow).toBe("register");
  });
});
