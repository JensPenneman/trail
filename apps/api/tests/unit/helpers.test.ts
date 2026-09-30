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
