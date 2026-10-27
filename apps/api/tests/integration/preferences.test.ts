import { apiPaths } from "@trail/contracts/apiPaths";
import { finishAuthResponseSchema } from "@trail/contracts/auth";
import { apiErrorSchema } from "@trail/contracts/errors";
import { defaultPreferences } from "@trail/contracts/preferences";
import { profileResponseSchema } from "@trail/contracts/profile";
import { sessionResponseSchema } from "@trail/contracts/user";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createApiToken } from "../support/apiTokenFlows";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
let owner: Agent;
let other: Agent;
const ownerEmail = "first@example.com";

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;
const patchMe = (agent: Agent, body: unknown) =>
  agent
    .patch(apiPaths.me.root)
    .set("Origin", testOrigin)
    .send(body as object);
const preferencesOf = async (agent: Agent) =>
  sessionResponseSchema.parse((await agent.get(apiPaths.auth.session).expect(200)).body).user
    .preferences;
/** What the database holds for an account: only the preferences it set. */
const storedFor = async (email: string) =>
  (
    await t.ctx.pool.query<{ preferences: unknown }>(
      "SELECT preferences FROM users WHERE email = $1",
      [email],
    )
  ).rows[0]?.preferences;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  const finished = await signUp(owner, new SoftwareAuthenticator(), ownerEmail);
  // A new account starts at the defaults, and its sign-in answer says so.
  expect(finishAuthResponseSchema.parse(finished).user.preferences).toEqual(defaultPreferences);
  other = agentFor(t.app);
  await signUp(other, new SoftwareAuthenticator(), "other@allowed.test");
});

afterAll(async () => {
  await t.close();
});

describe("preferences (PATCH /api/me)", () => {
  it("start at the defaults, with nothing stored", async () => {
    expect(await preferencesOf(owner)).toEqual(defaultPreferences);
    const me = sessionResponseSchema.parse((await owner.get(apiPaths.me.root).expect(200)).body);
    expect(me.user.preferences).toEqual(defaultPreferences);
    expect(await storedFor(ownerEmail)).toEqual({});
  });

  it("merge what is sent into what was set before", async () => {
    const dark = await patchMe(owner, { preferences: { mapStyle: "dark" } }).expect(200);
    expect(sessionResponseSchema.parse(dark.body).user.preferences).toEqual({
      ...defaultPreferences,
      mapStyle: "dark",
    });
    await patchMe(owner, { preferences: { level: "raw" } }).expect(200);
    const both = await patchMe(owner, {
      displayName: "Jens",
      preferences: { showOwnActivity: true },
    }).expect(200);
    expect(sessionResponseSchema.parse(both.body).user).toMatchObject({
      displayName: "Jens",
      preferences: { mapStyle: "dark", level: "raw", showOwnActivity: true },
    });
    // The session of every later request carries them; nothing else was stored.
    expect(await preferencesOf(owner)).toEqual({
      mapStyle: "dark",
      level: "raw",
      showOwnActivity: true,
    });
    expect(await storedFor(ownerEmail)).toEqual({
      mapStyle: "dark",
      level: "raw",
      showOwnActivity: true,
    });
    // A profile change without preferences leaves them alone.
    await patchMe(owner, { timezone: "Europe/Brussels" }).expect(200);
    expect((await preferencesOf(owner)).mapStyle).toBe("dark");
    expect(await preferencesOf(other)).toEqual(defaultPreferences);
  });

  it("keep both of two changes that arrive at the same time", async () => {
    await Promise.all([
      patchMe(owner, { preferences: { mapStyle: "satellite" } }).expect(200),
      patchMe(owner, { preferences: { level: "averaged" } }).expect(200),
    ]);
    expect(await preferencesOf(owner)).toMatchObject({ mapStyle: "satellite", level: "averaged" });
  });

  it("refuse unknown names and values outside the choices, and change nothing", async () => {
    const before = await storedFor(ownerEmail);
    const unknown = await patchMe(owner, { preferences: { mapStyle: "light", theme: "pink" } });
    expect(unknown.status).toBe(400);
    expect(errorOf(unknown.body)).toMatchObject({
      code: "validation_failed",
      fields: { preferences: ['Unrecognized key: "theme"'] },
    });
    const level = await patchMe(owner, { preferences: { level: "smoothed" } }).expect(400);
    expect(errorOf(level.body).fields).toHaveProperty(["preferences.level"]);
    const flag = await patchMe(owner, { preferences: { showOwnActivity: "yes" } }).expect(400);
    expect(errorOf(flag.body).fields).toHaveProperty(["preferences.showOwnActivity"]);
    await patchMe(owner, { preferences: "dark" }).expect(400);
    await patchMe(owner, { preferences: ["dark"] }).expect(400);
    expect(await storedFor(ownerEmail)).toEqual(before);
  });

  it("read values a later release may have stored as the defaults, and keep them stored", async () => {
    await t.ctx.pool.query(
      `UPDATE users SET preferences = '{"mapStyle": "neon", "later": true}' WHERE email = $1`,
      [ownerEmail],
    );
    expect(await preferencesOf(owner)).toEqual(defaultPreferences);
    await patchMe(owner, { preferences: { level: "mapped" } }).expect(200);
    expect(await preferencesOf(owner)).toEqual({ ...defaultPreferences, level: "mapped" });
    expect(await storedFor(ownerEmail)).toEqual({ mapStyle: "neon", later: true, level: "mapped" });
    // The column holds an object, whatever writes to it.
    await expect(
      t.ctx.pool.query(`UPDATE users SET preferences = '[]' WHERE email = $1`, [ownerEmail]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("are changed by the signed-in browser only", async () => {
    const noOrigin = await owner
      .patch(apiPaths.me.root)
      .send({ preferences: { mapStyle: "light" } })
      .expect(403);
    expect(errorOf(noOrigin.body).code).toBe("origin_not_allowed");
    await agentFor(t.app)
      .patch(apiPaths.me.root)
      .set("Origin", testOrigin)
      .send({ preferences: { mapStyle: "light" } })
      .expect(401);
    // An API token reaches /api/v1 only, and its profile there has no preferences.
    const { secret } = await createApiToken(owner, {
      name: "Script",
      scopes: ["profile:read"],
      deviceIds: null,
      allowedIps: null,
      expiresAt: null,
    });
    await agentFor(t.app)
      .patch(apiPaths.me.root)
      .set("Authorization", bearer(secret))
      .set("Origin", testOrigin)
      .send({ preferences: { mapStyle: "light" } })
      .expect(401);
    const profile = await agentFor(t.app)
      .get(apiPaths.v1.me)
      .set("Authorization", bearer(secret))
      .expect(200);
    expect(profileResponseSchema.parse(profile.body).user.id).toBeTruthy();
    expect(profile.body.user).not.toHaveProperty("preferences");
    expect((await preferencesOf(owner)).mapStyle).not.toBe("light");
  });
});
