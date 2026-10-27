import { describe, expect, it } from "vitest";
import { isSignedInPath } from "../src/app/isSignedInPath";
import { legacyMapPath, legacyPeoplePath } from "../src/app/legacyMapPath";
import { loginPath } from "../src/app/loginPath";
import { safeNextPath } from "../src/app/safeNextPath";
import { settingsPathFor } from "../src/settings/settingsTree";

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

  it("knows which paths need a session, every page of Settings among them", () => {
    for (const path of [
      "/",
      "/history",
      "/explore",
      "/people",
      "/devices",
      "/devices/abc",
      "/insights",
      "/insights/time",
      "/insights/roads",
      "/insights/transport/car",
      "/settings",
      "/settings/",
      "/settings/profile",
      "/settings/passkeys",
      "/settings/passkeys/abc",
      "/settings/browsers",
      "/settings/tokens",
      "/settings/tokens/abc",
      "/settings/mcp",
      "/settings/sharing",
      "/settings/sharing/abc",
      "/settings/links",
      "/settings/links/abc/",
      "/settings/privacy/viewers",
      "/settings/privacy/access-log",
      "/settings/data",
      "/settings/preferences",
      "/settings/notifications",
      "/settings/about",
      "/settings/accounts",
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
      "/insights/nope",
      "/insights/transport",
      "/settings/nope",
      "/settings/privacy",
      "/settings/profile/x",
      "/settings/passkeys/a/b",
      "/settingsx",
      "/xsettings/profile",
    ]) {
      expect(isSignedInPath(path), path).toBe(false);
    }
  });
});

describe("addresses of the pages the People page replaced", () => {
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

  it("take the People page of old home, as it was", () => {
    expect(legacyPeoplePath(new URL("https://trail.example.com/people"))).toBe("/");
    expect(
      legacyPeoplePath(
        new URL("https://trail.example.com/people?view=heat&people=me,a&devices=b#x"),
      ),
    ).toBe("/?view=heat&people=me,a&devices=b#x");
  });
});

describe("anchors of the single Settings page of old", () => {
  it("open their page, and nothing otherwise (then /settings itself shows)", () => {
    expect(settingsPathFor("", false)).toBeNull();
    expect(settingsPathFor("#", false)).toBeNull();
    expect(settingsPathFor("#profile", false)).toBe("/settings/profile");
    expect(settingsPathFor("#tokens", false)).toBe("/settings/tokens");
    expect(settingsPathFor("#api-tokens", false)).toBe("/settings/tokens");
    expect(settingsPathFor("#browsers", false)).toBe("/settings/browsers");
    expect(settingsPathFor("#sessions", false)).toBe("/settings/browsers");
    expect(settingsPathFor("#link", false)).toBe("/settings/passkeys#passkey-link");
    expect(settingsPathFor("#passkey-link", false)).toBe("/settings/passkeys#passkey-link");
    expect(settingsPathFor("#sharing", false)).toBe("/settings/sharing");
    expect(settingsPathFor("#links", false)).toBe("/settings/links");
    expect(settingsPathFor("#Data", false)).toBe("/settings/data");
    expect(settingsPathFor("#export", false)).toBe("/settings/data#export");
    expect(settingsPathFor("#about", false)).toBe("/settings/about");
    expect(settingsPathFor("#%E0%A4%A", false)).toBeNull();
    expect(settingsPathFor("#_r_5_", false)).toBeNull();
  });

  it("keep the accounts of the server to administrators", () => {
    for (const anchor of ["#people", "#accounts", "#invites"]) {
      expect(settingsPathFor(anchor, true), anchor).toBe("/settings/accounts");
      expect(settingsPathFor(anchor, false), anchor).toBeNull();
    }
  });

  it("open nothing for the names every object has", () => {
    for (const anchor of ["#__proto__", "#constructor", "#toString", "#hasOwnProperty"]) {
      expect(settingsPathFor(anchor, true), anchor).toBeNull();
    }
  });
});
