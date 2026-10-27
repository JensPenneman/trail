import { describe, expect, it } from "vitest";
import { settingsBadgeValue } from "../src/settings/settingsBadges";
import { fold, searchSettings, settingsSearchIndex } from "../src/settings/settingsSearchIndex";
import {
  settingsGroupsFor,
  settingsNodes,
  settingsPage,
  settingsPageNodes,
  settingsPlaceOf,
} from "../src/settings/settingsTree";
import { apiToken, config, device, outgoingShare, shareLink, user } from "./support/fixtures";

const labelsOf = (isAdmin: boolean) =>
  settingsGroupsFor(isAdmin).map(({ group, nodes }) => [
    group.label,
    nodes.map((node) => node.label),
  ]);

describe("the Settings tree", () => {
  it("has the groups and rows of the plan, in their order", () => {
    expect(labelsOf(true)).toEqual([
      ["Account", ["Profile", "Passkeys", "Browsers"]],
      ["Privacy & data", ["Sharing", "Public links", "Who viewed you", "Access log", "Your data"]],
      ["Developer", ["API tokens", "MCP", "API reference"]],
      ["App", ["Preferences", "Notifications", "About"]],
      ["Admin", ["Accounts"]],
    ]);
  });

  it("keeps administrators' rows from everyone else", () => {
    expect(labelsOf(false).map(([group]) => group)).not.toContain("Admin");
    expect(labelsOf(false).flatMap(([, rows]) => rows)).not.toContain("Accounts");
  });

  it("puts every page at an address of its own under /settings", () => {
    const paths = settingsPageNodes.flatMap((page) => [
      page.path,
      ...(page.details ?? []).map((detail) => detail.path),
    ]);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths)
      expect(path, path).toMatch(/^\/settings\/[a-z-]+(\/(?:[a-z-]+|:[a-zA-Z]+))*$/);
    expect(new Set(settingsNodes.map((node) => node.id)).size).toBe(settingsNodes.length);
    expect(settingsPage("viewers").path).toBe("/settings/privacy/viewers");
    expect(settingsPage("access-log").path).toBe("/settings/privacy/access-log");
    expect(settingsPage("accounts")).toMatchObject({ path: "/settings/accounts", adminOnly: true });
    // A page's anchors for search are ids its headings can carry.
    for (const page of settingsPageNodes) {
      for (const row of page.rows ?? []) {
        if (row.anchor !== undefined) expect(row.anchor).toMatch(/^[a-z][a-z-]*$/);
      }
    }
  });

  it("knows how deep an address is, and whose page it belongs to", () => {
    expect(settingsPlaceOf("/settings")).toEqual({ level: 0, page: undefined });
    expect(settingsPlaceOf("/settings/")).toMatchObject({ level: 0 });
    expect(settingsPlaceOf("/settings/tokens")).toMatchObject({ level: 1, page: { id: "tokens" } });
    expect(settingsPlaceOf("/settings/tokens/abc")).toMatchObject({
      level: 2,
      page: { id: "tokens" },
    });
    expect(settingsPlaceOf("/settings/privacy/viewers")).toMatchObject({
      level: 1,
      page: { id: "viewers" },
    });
    expect(settingsPlaceOf("/settings/elsewhere")).toEqual({ level: 1, page: undefined });
  });
});

describe("search in Settings", () => {
  const everyone = settingsSearchIndex(false);
  const admin = settingsSearchIndex(true);
  const found = (query: string, index = everyone) =>
    searchSettings(index, query).map((entry) => [entry.label, entry.trail, entry.to]);

  it("folds case, accents and punctuation, and reads & as and", () => {
    expect(fold("  Privacy & Data ")).toBe("privacy and data");
    expect(fold("Crème-brûlée, API-tokens")).toBe("creme brulee api tokens");
  });

  it("finds pages by name, with the group they are in", () => {
    expect(found("public links")[0]).toEqual(["Public links", "Privacy & data", "/settings/links"]);
    expect(found("privacy and data").map(([label]) => label)).toEqual(
      expect.arrayContaining(["Sharing", "Public links", "Who viewed you", "Access log"]),
    );
  });

  it("finds the parts of pages, with where they are, and leads to their heading", () => {
    expect(found("export")).toEqual([
      ["Export", "Privacy & data › Your data", "/settings/data#export"],
      ["Your data", "Privacy & data", "/settings/data"],
    ]);
    expect(found("delete acc")[0]).toEqual([
      "Delete account",
      "Privacy & data › Your data",
      "/settings/data#delete-account",
    ]);
    expect(found("sign out")[0]?.[0]).toBe("Sign out");
  });

  it("finds by other words, best matches of the name first", () => {
    expect(found("gpx").map(([label]) => label)).toEqual(["Your data", "Export"]);
    expect(found("ntfy").map(([label]) => label)).toEqual(["Notifications"]);
    expect(found("satellite").map(([label]) => label)).toEqual(["Preferences", "Map style"]);
    expect(found("openapi")).toEqual([["API reference", "Developer", "/docs"]]);
    expect(searchSettings(everyone, "openapi")[0]?.external).toBe(true);
    // Every word counts, in any order.
    expect(found("token create").map(([label]) => label)).toEqual([
      "Create token",
      "Create an Agent token",
    ]);
  });

  it("finds nothing for nothing, and administrators' pages only for them", () => {
    expect(found("")).toEqual([]);
    expect(found("  ·  ")).toEqual([]);
    expect(found("zzz")).toEqual([]);
    expect(found("invite")).toEqual([]);
    expect(found("invite", admin)[0]).toEqual([
      "Invite someone",
      "Admin › Accounts",
      "/settings/accounts#invite",
    ]);
  });

  it("stops at a limit", () => {
    expect(searchSettings(admin, "a", 5)).toHaveLength(5);
  });
});

describe("the values of the rows", () => {
  const now = Date.now();
  const sources = { user, now, count: (value: number) => String(value) };

  it("count what the page lists once it has loaded, and say nothing for none", () => {
    expect(settingsBadgeValue("passkeys", sources)).toBeNull();
    expect(settingsBadgeValue("sharing", { ...sources, shares: [] })).toBeNull();
    expect(settingsBadgeValue("sharing", { ...sources, shares: [outgoingShare()] })).toBe("1");
    expect(
      settingsBadgeValue("links", {
        ...sources,
        links: [shareLink(), shareLink({ status: "expired" }), shareLink()],
      }),
    ).toBe("2 active");
    expect(
      settingsBadgeValue("links", { ...sources, links: [shareLink({ status: "expired" })] }),
    ).toBeNull();
  });

  it("count the tokens that still work, by the clock", () => {
    const tokens = [
      apiToken(),
      apiToken({ status: "revoked" }),
      apiToken({ expiresAt: new Date(now - 1000).toISOString() }),
      apiToken({ expiresAt: null }),
    ];
    expect(settingsBadgeValue("tokens", { ...sources, tokens })).toBe("2");
  });

  it("show the name, the version and whether alerts are on", () => {
    expect(settingsBadgeValue("profile", sources)).toBe("Jens");
    expect(settingsBadgeValue("about", { ...sources, config })).toBe("0.1.0");
    const off = { ...config, features: { alerts: false } };
    expect(settingsBadgeValue("notifications", { ...sources, config: off })).toBe("Off");
    expect(settingsBadgeValue("notifications", { ...sources, config })).toBeNull();
    expect(settingsBadgeValue("notifications", { ...sources, config, devices: [device()] })).toBe(
      "On",
    );
    expect(
      settingsBadgeValue("notifications", {
        ...sources,
        config,
        devices: [device({ alertsEnabled: false })],
      }),
    ).toBe("Off");
  });
});
