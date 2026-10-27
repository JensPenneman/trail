import { describe, expect, it } from "vitest";
import { isSignedInPath } from "../src/app/isSignedInPath";
import { legacyMapPath } from "../src/app/legacyMapPath";
import { loginPath } from "../src/app/loginPath";
import { safeNextPath } from "../src/app/safeNextPath";
import { settingsPathFor } from "../src/app/settingsSections";

describe("sign-in redirects", () => {
  it("remembers where the person was", () => {
    expect(loginPath({ pathname: "/history", search: "?date=2026-09-01", hash: "" })).toBe(
      "/login?next=%2Fhistory%3Fdate%3D2026-09-01",
    );
    expect(loginPath({ pathname: "/", search: "", hash: "" })).toBe("/login");
  });

  it("only follows in-app paths after sign-in", () => {
    expect(safeNextPath("/devices/abc")).toBe("/devices/abc");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });

  it("knows which paths need a session", () => {
    for (const path of [
      "/",
      "/history",
      "/explore",
      "/people",
      "/devices",
      "/devices/abc",
      "/settings",
      "/settings/profile",
      "/settings/tokens",
      "/settings/sharing",
      "/settings/people",
    ]) {
      expect(isSignedInPath(path), path).toBe(true);
    }
    for (const path of [
      "/login",
      "/invite/x",
      "/link/x",
      "/nope",
      "/s",
      "/people/x",
      "/settings/nope",
    ]) {
      expect(isSignedInPath(path), path).toBe(false);
    }
  });
});

describe("addresses of the pages the Map page replaced", () => {
  it("carry every parameter over to the view", () => {
    expect(
      legacyMapPath(
        new URL("https://trail.example.com/history?date=2026-09-01&devices=a,b&level=raw"),
        "history",
      ),
    ).toBe("/?view=history&date=2026-09-01&devices=a%2Cb&level=raw");
    expect(
      legacyMapPath(
        new URL("https://trail.example.com/history?from=2026-09-01&to=2026-09-07"),
        "history",
      ),
    ).toBe("/?view=history&from=2026-09-01&to=2026-09-07");
    expect(legacyMapPath(new URL("https://trail.example.com/explore"), "heat")).toBe("/?view=heat");
    expect(legacyMapPath(new URL("https://trail.example.com/explore?view=live#x"), "heat")).toBe(
      "/?view=heat#x",
    );
  });
});

describe("anchors of the single Settings page of old", () => {
  it("open their section, and Profile otherwise", () => {
    expect(settingsPathFor("", false)).toBe("/settings/profile");
    expect(settingsPathFor("#tokens", false)).toBe("/settings/tokens");
    expect(settingsPathFor("#api-tokens", false)).toBe("/settings/tokens");
    expect(settingsPathFor("#browsers", false)).toBe("/settings/passkeys#browsers");
    expect(settingsPathFor("#sessions", false)).toBe("/settings/passkeys#browsers");
    expect(settingsPathFor("#link", false)).toBe("/settings/passkeys#passkey-link");
    expect(settingsPathFor("#Data", false)).toBe("/settings/data");
    expect(settingsPathFor("#about", false)).toBe("/settings/about");
    expect(settingsPathFor("#%E0%A4%A", false)).toBe("/settings/profile");
    expect(settingsPathFor("#_r_5_", false)).toBe("/settings/profile");
  });

  it("keep the accounts of the server to administrators", () => {
    expect(settingsPathFor("#people", true)).toBe("/settings/people");
    expect(settingsPathFor("#people", false)).toBe("/settings/profile");
  });

  it("open Profile for the names every object has", () => {
    expect(settingsPathFor("#__proto__", false)).toBe("/settings/profile");
    expect(settingsPathFor("#constructor", false)).toBe("/settings/profile");
  });
});
