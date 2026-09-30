import { describe, expect, it } from "vitest";
import { isSignedInPath } from "../src/app/isSignedInPath";
import { loginPath } from "../src/app/loginPath";
import { safeNextPath } from "../src/app/safeNextPath";

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
    for (const path of ["/", "/history", "/explore", "/devices", "/devices/abc", "/settings"]) {
      expect(isSignedInPath(path)).toBe(true);
    }
    for (const path of ["/login", "/invite/x", "/link/x", "/nope"]) {
      expect(isSignedInPath(path)).toBe(false);
    }
  });
});
