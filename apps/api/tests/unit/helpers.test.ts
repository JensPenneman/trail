import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { defaultDeviceKey, slugify } from "../../src/devices/defaultDeviceKey";
import { generateDeviceToken } from "../../src/devices/generateDeviceToken";
import { csvField } from "../../src/export/csvField";
import { escapeXml } from "../../src/export/escapeXml";
import { redactUrl } from "../../src/http/redactUrl";
import { hashToken } from "../../src/lib/hashToken";
import { localDate } from "../../src/lib/localDate";
import { serializeError } from "../../src/logging/serializeError";

describe("device keys and tokens", () => {
  it("slugs names into Overland device ids", () => {
    expect(slugify("Jens’s iPhone 15 Pro", 35)).toBe("jenss-iphone-15-pro");
    expect(slugify("Crème brûlée!!", 35)).toBe("creme-brulee");
    expect(slugify("📱", 35)).toBe("device");
    expect(slugify("a".repeat(50), 35)).toHaveLength(35);
  });

  it("adds a random suffix and stays a valid device key", () => {
    const key = defaultDeviceKey("Work phone");
    expect(key).toMatch(/^work-phone-[a-z0-9]{4}$/);
    expect(defaultDeviceKey("x".repeat(80))).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("creates trl_ tokens and stores only their hash", () => {
    const { token, hash, hint } = generateDeviceToken();
    expect(token).toMatch(/^trl_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hint).toBe(token.slice(-4));
  });
});

describe("export encoding", () => {
  it("quotes CSV fields and defuses formulas", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(3.5)).toBe("3.5");
    expect(csvField('Office "5G", 2nd floor')).toBe('"Office ""5G"", 2nd floor"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("-2")).toBe("'-2");
  });

  it("escapes XML and drops forbidden control characters", () => {
    expect(escapeXml(`Jens's <"phone"> & co${String.fromCharCode(7)}`)).toBe(
      "Jens&apos;s &lt;&quot;phone&quot;&gt; &amp; co",
    );
  });
});

describe("logging safety", () => {
  it("removes device tokens from logged URLs", () => {
    expect(redactUrl("/api/overland?token=trl_secret&x=1")).toBe(
      "/api/overland?token=[redacted]&x=1",
    );
    expect(redactUrl("/api/overland?a=1&access_token=trl_secret")).toBe(
      "/api/overland?a=1&access_token=[redacted]",
    );
  });

  it("recognises token parameters the way the query parser reads them", () => {
    // `%74oken` is `token` to the router, so it authenticates — and must not be logged.
    expect(redactUrl("/api/overland?%74oken=trl_secret")).toBe("/api/overland?token=[redacted]");
    expect(redactUrl("/api/overland?TOKEN=trl_a&Access_Token=trl_b&x=a%20b")).toBe(
      "/api/overland?TOKEN=[redacted]&Access_Token=[redacted]&x=a%20b",
    );
  });

  it("removes one-time link and invite tokens from logged paths", () => {
    expect(redactUrl("/link/5JqNf3kP0xY")).toBe("/link/[redacted]");
    expect(redactUrl("/invite/5JqNf3kP0xY?from=mail")).toBe("/invite/[redacted]?from=mail");
    expect(redactUrl("/api/auth/link/5JqNf3kP0xY")).toBe("/api/auth/link/[redacted]");
    expect(redactUrl("/api/auth/link/5JqNf3kP0xY/start")).toBe("/api/auth/link/[redacted]/start");
    // Routing ignores case and the SPA decodes the path: those spellings reach the same pages.
    expect(redactUrl("/API/Auth/LINK/5JqNf3kP0xY")).toBe("/API/Auth/LINK/[redacted]");
    expect(redactUrl("/%6Cink/5JqNf3kP0xY")).toBe("/%6Cink/[redacted]");
    expect(redactUrl("/devices/01926f3a?x=1")).toBe("/devices/01926f3a?x=1");
    expect(redactUrl("/link")).toBe("/link");
  });

  it("removes share link secrets that a client puts into a URL after all", () => {
    // They belong in the fragment of the page and the X-Share-Secret header only.
    const secret = `trls_${"Ab9-_".repeat(8)}xyz`;
    expect(redactUrl(`/api/public/share?secret=${secret}`)).toBe(
      "/api/public/share?secret=[redacted]",
    );
    expect(redactUrl(`/somewhere/${secret}`)).toBe("/somewhere/[redacted]");
    expect(redactUrl(`/somewhere?next=%2Fs%23${secret}`)).toBe("/somewhere?next=[redacted]");
    // A fragment never reaches the server; one sent anyway is not logged.
    expect(redactUrl(`/s#${secret}`)).toBe("/s");
    expect(redactUrl("/api/public/share")).toBe("/api/public/share");
  });

  it("removes a secret that a client sends as a parameter's name", () => {
    const secret = `trls_${"Ab9-_".repeat(8)}xyz`;
    expect(redactUrl(`/api/public/share?${secret}`)).toBe("/api/public/share?[redacted]=");
    expect(redactUrl(`/api/v1/me?trlk_${"x".repeat(43)}=1&a=b`)).toBe(
      "/api/v1/me?[redacted]=1&a=b",
    );
  });

  it("removes API token secrets wherever a client put them in the URL", () => {
    const secret = `trlk_${"Ab9-_".repeat(8)}xyz`;
    expect(secret).toHaveLength(48);
    expect(redactUrl(`/api/v1/me?key=${secret}&x=1`)).toBe("/api/v1/me?key=[redacted]&x=1");
    expect(redactUrl(`/api/v1/me?auth=Bearer%20${secret}`)).toBe("/api/v1/me?auth=[redacted]");
    expect(redactUrl(`/api/v1/${secret}/devices`)).toBe("/api/v1/[redacted]/devices");
    expect(redactUrl(`/api/v1/%74rlk_${secret.slice(5)}`)).toBe("/api/v1/[redacted]");
    expect(redactUrl("/api/v1/devices?cursor=trlk_short")).toBe(
      "/api/v1/devices?cursor=trlk_short",
    );
  });

  it("keeps only what names the failure of a Postgres error, never the refused value", () => {
    const refused = Object.assign(
      new Error('invalid input syntax for type double precision: "51.0543 3.7174"'),
      {
        severity: "ERROR",
        code: "22P02",
        routine: "float8in_internal",
        where: "unnamed portal parameter $1 = '51.0543 3.7174'",
        hint: "check 51.0543",
      },
    );
    const serialized = JSON.stringify(serializeError(new Error("wrapped", { cause: refused })));
    expect(serialized).toContain("22P02");
    expect(serialized).toContain("float8in_internal");
    expect(serialized).not.toContain("51.0543");
  });

  it("drops every value of an upload in the OsmAnd format from the URL, and device tokens anywhere", () => {
    const token = `trl_${"A".repeat(43)}`;
    expect(redactUrl(`/api/osmand?id=${token}&lat=51.0543&lon=3.7174&timestamp=1730000000`)).toBe(
      "/api/osmand?id=[redacted]&lat=[redacted]&lon=[redacted]&timestamp=[redacted]",
    );
    expect(redactUrl("/API/OsmAnd/?lat=51.05")).toBe("/API/OsmAnd/?lat=[redacted]");
    expect(redactUrl("/api/%6Fsmand?lat=51.05")).toBe("/api/%6Fsmand?lat=[redacted]");
    // A mistyped template's path, below the endpoint or with doubled slashes, ends in a 404 at warn.
    expect(redactUrl("/api/osmand/more?lat=51.05")).toBe("/api/osmand/more?lat=[redacted]");
    expect(redactUrl("/api//osmand?lat=51.05&lon=3.71")).toBe(
      "/api//osmand?lat=[redacted]&lon=[redacted]",
    );
    expect(redactUrl("//api/OSMAND//x/?timestamp=1")).toBe("//api/OSMAND//x/?timestamp=[redacted]");
    expect(redactUrl("/api/osmandx?lat=51.05")).toBe("/api/osmandx?lat=51.05");
    // A device token is found by its shape wherever a client puts it.
    expect(redactUrl(`/api/owntracks?u=jens&id=${token}`)).toBe(
      "/api/owntracks?u=jens&id=[redacted]",
    );
    expect(redactUrl(`/api/whatever/${token}`)).toBe("/api/whatever/[redacted]");
    expect(redactUrl(`/api/overland?next=Bearer%20${token}`)).toBe("/api/overland?next=[redacted]");
  });

  it("never logs a request body a body parser kept in its error", () => {
    const parseError = Object.assign(new SyntaxError("Unexpected token"), {
      status: 400,
      type: "entity.parse.failed",
      body: "id=trl_secret&lat=51.0543",
    });
    const serialized = JSON.stringify(serializeError(parseError));
    expect(serialized).toContain("entity.parse.failed");
    expect(serialized).not.toContain("51.0543");
    expect(serialized).not.toContain("trl_secret");
  });

  it("never logs query parameters or failing rows of database errors", () => {
    const cause = Object.assign(new Error("null value violates not-null constraint"), {
      code: "23502",
      detail: "Failing row contains (51.0543, 3.7174).",
    });
    const error = new DrizzleQueryError(
      "insert into locations values ($1, $2)",
      [51.0543, 3.7174],
      cause,
    );
    const serialized = JSON.stringify(serializeError(error));
    expect(serialized).toContain("insert into locations");
    expect(serialized).toContain("23502");
    expect(serialized).not.toContain("51.0543");
  });
});

describe("localDate", () => {
  it("returns the calendar day in the given time zone", () => {
    const instant = new Date("2026-09-29T22:30:00Z");
    expect(localDate(instant, "Europe/Brussels")).toBe("2026-09-30");
    expect(localDate(instant, "UTC")).toBe("2026-09-29");
    expect(localDate(instant, "America/New_York")).toBe("2026-09-29");
  });
});
