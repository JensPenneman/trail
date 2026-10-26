import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import {
  createShareLinkResponseSchema,
  publicShareResponseSchema,
  shareLinkListResponseSchema,
  shareLinkSecretPattern,
  shareSecretHeader,
} from "@trail/contracts/shareLink";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { anonymous, from, uploadOf } from "../support/sharingFlows";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * Public links (docs/architecture.md §8.4): a secret address that shows the
 * owner's location without an account, until it expires or is turned off —
 * and nothing about the owner beyond what the link shares.
 */
let t: TestContext;
const lines: string[] = [];
let owner: Agent;
let ownerId = "";
let ownerCookie = "";
let phone = "";
let watch = "";

const exact = { lat: 50.8467123, lon: 4.3524567 };
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;

const makeLink = async (body: Record<string, unknown> = {}) =>
  createShareLinkResponseSchema.parse(
    (
      await from(owner, "post", apiPaths.v1.shareLinks.root, {
        precision: "precise",
        ...body,
      }).expect(201)
    ).body,
  );

/** What the link page asks for: the secret in its header, in no URL. */
const visit = (secret: string, app = t.app) =>
  anonymous(app, apiPaths.publicShare).set(shareSecretHeader, secret);

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
  ({ agent: owner, cookie: ownerCookie } = await signUpWithCookie(t.app, "first@example.com"));
  ownerId = (await owner.get("/api/auth/session").expect(200)).body.user.id;
  await from(owner, "patch", apiPaths.me.root, { displayName: "Jens Penneman" }).expect(200);
  const created = await createDevice(owner, { name: "Jens’s iPhone" });
  phone = created.device.id;
  watch = (await createDevice(owner, { name: "Jens’s watch" })).device.id;
  await postOverland(
    t.app,
    created.credentials.accessToken,
    uploadOf([
      { ago: 2 * 86_400, lat: 50.8, lon: 4.3 },
      { ago: 7200, lat: 50.84, lon: 4.35 },
      { ago: 60, ...exact },
    ]),
  ).expect(200);
});

afterAll(async () => {
  await t.close();
});

describe("making a link", () => {
  it("shows its secret once and keeps only its hash", async () => {
    const before = Date.now();
    const made = await makeLink();
    expect(made.secret).toMatch(shareLinkSecretPattern);
    // The secret is the fragment: browsers never send it to a server, a proxy or as a referrer.
    expect(made.url).toBe(`${testOrigin}/s#${made.secret}`);
    expect(made.link).toMatchObject({
      label: "Jens",
      deviceIds: null,
      precision: "precise",
      historyDays: null,
      includeDetails: false,
      status: "active",
      viewCount: 0,
      lastViewedAt: null,
    });
    // 24 hours unless asked otherwise.
    const expires = Date.parse(made.link.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 86_400_000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 86_400_000);
    const listed = await owner.get(apiPaths.v1.shareLinks.root).expect(200);
    expect(shareLinkListResponseSchema.parse(listed.body).links[0]?.id).toBe(made.link.id);
    expect(JSON.stringify(listed.body)).not.toContain(made.secret.slice(5));
    const [stored] = (
      await t.ctx.db.execute<{ token_hash: string }>(
        sql`SELECT token_hash FROM share_links WHERE id = ${made.link.id}`,
      )
    ).rows;
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token_hash).not.toContain(made.secret.slice(5));
  });

  it("checks the expiry, the devices and history", async () => {
    const refused = async (body: Record<string, unknown>, status: number, field?: string) => {
      const response = await from(owner, "post", apiPaths.v1.shareLinks.root, {
        precision: "precise",
        ...body,
      }).expect(status);
      if (field !== undefined) {
        expect(Object.keys(errorOf(response.body).fields ?? {})).toContain(field);
      }
    };
    await refused({ expiresAt: new Date(Date.now() - 1000).toISOString() }, 400, "expiresAt");
    await refused(
      { expiresAt: new Date(Date.now() + 31 * 86_400_000).toISOString() },
      400,
      "expiresAt",
    );
    await refused({ precision: "approximate", historyDays: 1 }, 400, "historyDays");
    await refused({ historyDays: 8 }, 400, "historyDays");
    await refused({ label: "" }, 400, "label");
    await refused({ label: "x".repeat(61) }, 400, "label");
    await refused({ precision: "everywhere" }, 400, "precision");
    await refused({ deviceIds: ["0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"] }, 404);
    const month = await makeLink({
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(month.link.status).toBe("active");
    await from(owner, "delete", apiPaths.v1.shareLinks.one(month.link.id)).expect(204);
  });

  it("allows 20 working links", async () => {
    const current = shareLinkListResponseSchema
      .parse((await owner.get(apiPaths.v1.shareLinks.root).expect(200)).body)
      .links.filter((link) => link.status === "active").length;
    const made: string[] = [];
    for (let index = current; index < 20; index += 1) made.push((await makeLink()).link.id);
    const refused = await from(owner, "post", apiPaths.v1.shareLinks.root, {
      precision: "area",
    }).expect(409);
    expect(errorOf(refused.body).code).toBe("conflict");
    for (const id of made) await from(owner, "delete", apiPaths.v1.shareLinks.one(id)).expect(204);
  });
});

describe("the public endpoint", () => {
  it("shows the label and the devices, and nothing of the account", async () => {
    const { secret } = await makeLink({ label: "Jens on his way" });
    const response = await visit(secret).set("Cookie", ownerCookie).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["set-cookie"]).toBeUndefined();
    const shown = publicShareResponseSchema.parse(response.body);
    expect(shown).toMatchObject({
      label: "Jens on his way",
      precision: "precise",
      historyDays: null,
    });
    expect(shown.devices.map((device) => device.name)).toEqual(["Jens’s iPhone", "Jens’s watch"]);
    expect(shown.devices[0]).toMatchObject({
      location: { ...exact, precision: "precise" },
      battery: null,
      activity: null,
      track: null,
    });
    expect(shown.devices[1]?.location).toBeNull();
    const text = JSON.stringify(response.body);
    for (const secretish of [
      ownerId,
      phone,
      watch,
      "first@example.com",
      "deviceKey",
      "tokenHint",
    ]) {
      expect(text).not.toContain(secretish);
    }
  });

  it("shows battery and activity only when the link includes them", async () => {
    const { secret } = await makeLink({ includeDetails: true, deviceIds: [phone] });
    const shown = publicShareResponseSchema.parse((await visit(secret).expect(200)).body);
    expect(shown.devices).toHaveLength(1);
    expect(shown.devices[0]?.battery).toMatchObject({ level: 0.66 });
    expect(shown.devices[0]?.activity).toEqual({ motion: ["walking"], tripMode: null, mode: null });
  });

  it("keeps approximate and area links coarse", async () => {
    for (const precision of ["approximate", "area"] as const) {
      const { secret } = await makeLink({ precision, deviceIds: [phone], includeDetails: true });
      const response = await visit(secret).expect(200);
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(String(exact.lat));
      expect(text).not.toContain(String(exact.lon));
      const shown = publicShareResponseSchema.parse(response.body);
      expect(shown.devices[0]?.location).toMatchObject({ precision, altitude: null, course: null });
      expect(shown.devices[0]?.track).toBeNull();
      // Read after read, the same cell.
      expect(publicShareResponseSchema.parse((await visit(secret).expect(200)).body)).toEqual(
        shown,
      );
    }
  });

  it("draws the shared history of precise links, never older points", async () => {
    const { secret } = await makeLink({ historyDays: 1, deviceIds: [phone] });
    const shown = publicShareResponseSchema.parse((await visit(secret).expect(200)).body);
    const track = shown.devices[0]?.track ?? [];
    expect(track.map((point) => point[1])).toEqual([50.84, exact.lat]);
    for (const point of track) {
      expect(point[2] * 1000).toBeGreaterThanOrEqual(Date.now() - 86_400_000 - 5_000);
    }
  });

  it("answers 404 for secrets that are missing, wrong, unknown, ended or turned off", async () => {
    const code = async (secret: string) => errorOf((await visit(secret).expect(404)).body).code;
    const missing = await anonymous(t.app, apiPaths.publicShare).expect(404);
    expect(errorOf(missing.body).code).toBe("not_found");
    expect(await code("not-a-secret")).toBe("not_found");
    expect(await code(`trls_${"A".repeat(43)}`)).toBe("not_found");
    expect(await code(`trlk_${"A".repeat(43)}`)).toBe("not_found");
    const ended = await makeLink();
    await visit(ended.secret).expect(200);
    await t.ctx.db.execute(
      sql`UPDATE share_links SET expires_at = now() - interval '1 second' WHERE id = ${ended.link.id}`,
    );
    expect(await code(ended.secret)).toBe("share_expired");
    const [listed] = shareLinkListResponseSchema
      .parse((await owner.get(apiPaths.v1.shareLinks.root).expect(200)).body)
      .links.filter((link) => link.id === ended.link.id);
    expect(listed?.status).toBe("expired");
    const off = await makeLink({ historyDays: 1 });
    await visit(off.secret).expect(200);
    await from(owner, "delete", apiPaths.v1.shareLinks.one(off.link.id)).expect(204);
    // At once, the cached track included.
    expect(await code(off.secret)).toBe("share_expired");
    await from(owner, "delete", apiPaths.v1.shareLinks.one(off.link.id)).expect(404);
    const listedAfter = shareLinkListResponseSchema.parse(
      (await owner.get(apiPaths.v1.shareLinks.root).expect(200)).body,
    ).links;
    expect(listedAfter.map((link) => link.id)).not.toContain(off.link.id);
  });

  it("counts a view at most once a minute", async () => {
    const { secret, link } = await makeLink();
    const count = async () => {
      await t.ctx.background.drain(5_000);
      return shareLinkListResponseSchema
        .parse((await owner.get(apiPaths.v1.shareLinks.root).expect(200)).body)
        .links.find((entry) => entry.id === link.id);
    };
    await visit(secret).expect(200);
    expect((await count())?.viewCount).toBe(1);
    await visit(secret).expect(200);
    await visit(secret).expect(200);
    const once = await count();
    expect(once?.viewCount).toBe(1);
    expect(once?.lastViewedAt).not.toBeNull();
    await t.ctx.db.execute(
      sql`UPDATE share_links SET last_viewed_at = now() - interval '61 seconds' WHERE id = ${link.id}`,
    );
    await visit(secret).expect(200);
    expect((await count())?.viewCount).toBe(2);
  });

  it("only reads: other methods and paths do not exist", async () => {
    const { secret } = await makeLink();
    const posted = await from(owner, "post", apiPaths.publicShare, {})
      .set(shareSecretHeader, secret)
      .expect(404);
    expect(errorOf(posted.body).code).toBe("not_found");
    // The secret in a path is no address at all.
    await anonymous(t.app, `${apiPaths.publicShare}/${secret}`).expect(404);
    await anonymous(t.app, `/api/public/shares/${secret}`).expect(404);
  });

  it("is owned by its maker only", async () => {
    const { link } = await makeLink();
    const stranger = await signUpWithCookie(t.app, "stranger@allowed.test");
    await from(stranger.agent, "delete", apiPaths.v1.shareLinks.one(link.id)).expect(404);
    const theirs = shareLinkListResponseSchema.parse(
      (await stranger.agent.get(apiPaths.v1.shareLinks.root).expect(200)).body,
    );
    expect(theirs.links).toEqual([]);
    await from(stranger.agent, "post", apiPaths.v1.shareLinks.root, {
      precision: "precise",
      deviceIds: [phone],
    }).expect(404);
  });

  it("sends the page's own headers on /s", async () => {
    // No built web app in the tests: the page itself is a 404 here, with the headers all the same.
    const response = await anonymous(t.app, apiPaths.sharePage.root);
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("never writes a secret to the access log", async () => {
    const { secret } = await makeLink();
    await visit(secret).expect(200);
    await visit(`trls_${"B".repeat(43)}`).expect(404);
    await anonymous(t.app, apiPaths.sharePage.root);
    // A careless client that puts it into a URL after all.
    await anonymous(t.app, `${apiPaths.publicShare}?secret=${secret}`).expect(404);
    await new Promise((resolve) => setImmediate(resolve));
    const logged = lines.filter((line) => line.includes(apiPaths.publicShare));
    expect(logged.length).toBeGreaterThanOrEqual(3);
    expect(lines.join("\n")).not.toContain(secret.slice(5));
    expect(lines.join("\n")).not.toContain("B".repeat(43));
  });
});

describe("the public endpoint's rate limit", () => {
  it("allows a few requests a minute per address", async () => {
    const limited = await createTestContext({ env: { RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE: "3" } });
    try {
      const { secret } = await makeLink();
      for (let index = 0; index < 3; index += 1) {
        await visit(secret, limited.app).expect(200);
      }
      const refused = await visit(secret, limited.app).expect(429);
      expect(errorOf(refused.body).code).toBe("rate_limited");
      expect(refused.headers["ratelimit-policy"]).toContain('"public-share"');
      // A different limit from the API's: other routes still answer.
      await anonymous(limited.app, apiPaths.config).expect(200);
    } finally {
      await limited.close();
    }
  });
});
