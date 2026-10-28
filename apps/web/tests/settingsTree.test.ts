import { describe, expect, it } from "vitest";
import { addDevicePath, devicePath, devicesPath } from "../src/devices/devicePaths";
import { settingsBadgeValue } from "../src/settings/settingsBadges";
import { fold, searchSettings, settingsSearchIndex } from "../src/settings/settingsSearchIndex";
import {
  settingsGroupsFor,
  settingsItemPath,
  settingsNodes,
  settingsPage,
  settingsPageNodes,
  settingsPart,
  settingsPlaceOf,
} from "../src/settings/settingsTree";
import {
  apiToken,
  car,
  config,
  device,
  ids,
  outgoingShare,
  shareLink,
  user,
} from "./support/fixtures";

const labelsOf = (isAdmin: boolean) =>
  settingsGroupsFor(isAdmin).map(({ group, nodes }) => [
    group.label,
    nodes.map((node) => node.label),
  ]);

describe("the Settings tree", () => {
  it("has the groups and rows of the plan, in their order", () => {
    expect(labelsOf(true)).toEqual([
      ["Account", ["Profile", "Devices", "Passkeys", "Browsers"]],
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
      ...(page.details ?? []).flatMap((detail) => [
        detail.path,
        ...(detail.parts ?? []).map((part) => part.path),
      ]),
    ]);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths)
      expect(path, path).toMatch(/^\/settings\/[a-z-]+(\/(?:[a-z-]+|:[a-zA-Z]+))*$/);
    expect(new Set(settingsNodes.map((node) => node.id)).size).toBe(settingsNodes.length);
    expect(settingsPage("viewers").path).toBe("/settings/privacy/viewers");
    expect(settingsPage("access-log").path).toBe("/settings/privacy/access-log");
    expect(settingsPage("accounts")).toMatchObject({ path: "/settings/accounts", adminOnly: true });
    expect(settingsPage("devices")).toMatchObject({ path: "/settings/devices", adminOnly: false });
    // A part of an item lives under the item's own address.
    for (const page of settingsPageNodes) {
      for (const detail of page.details ?? []) {
        for (const part of detail.parts ?? []) {
          expect(part.path.startsWith(`${detail.path}/`), part.path).toBe(true);
        }
      }
    }
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
    expect(settingsPlaceOf("/settings/devices")).toMatchObject({
      level: 1,
      page: { id: "devices" },
    });
    expect(settingsPlaceOf("/settings/devices/abc")).toMatchObject({
      level: 2,
      page: { id: "devices" },
    });
    for (const part of ["uploads", "points", "tracking", "setup"]) {
      expect(settingsPlaceOf(`/settings/devices/abc/${part}/`), part).toMatchObject({
        level: 3,
        page: { id: "devices" },
      });
    }
    expect(settingsPlaceOf("/settings/elsewhere")).toEqual({ level: 1, page: undefined });
  });

  it("makes the addresses of the devices from the tree, their ids made safe", () => {
    expect(devicesPath).toBe("/settings/devices");
    expect(addDevicePath).toBe("/settings/devices?add=1");
    expect(devicePath(ids.phone)).toBe(`/settings/devices/${ids.phone}`);
    expect(devicePath(ids.phone, "uploads")).toBe(`/settings/devices/${ids.phone}/uploads`);
    expect(devicePath(ids.phone, "points")).toBe(`/settings/devices/${ids.phone}/points`);
    expect(devicePath("a/b?c#d", "setup")).toBe("/settings/devices/a%2Fb%3Fc%23d/setup");
    expect(settingsItemPath("/settings/tokens/:tokenId", "x y")).toBe("/settings/tokens/x%20y");
    expect(settingsPart("tracking")).toMatchObject({
      label: "Tracking settings",
      path: "/settings/devices/:deviceId/tracking",
    });
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

  it("finds the person's devices by name, app and device ID, and leads to their pages", () => {
    const withDevices = settingsSearchIndex(false, {
      device: [
        { id: ids.phone, label: "iPhone 16", keywords: ["Overland", "iphone-16-k3f9"] },
        { id: ids.car, label: "Car", keywords: ["OwnTracks", "car-old-iphone"] },
      ],
    });
    const inIndex = (query: string) =>
      searchSettings(withDevices, query).map((entry) => [entry.label, entry.trail, entry.to]);
    expect(inIndex("iphone 16")[0]).toEqual([
      "iPhone 16",
      "Account › Devices",
      `/settings/devices/${ids.phone}`,
    ]);
    expect(inIndex("car")[0]).toEqual(["Car", "Account › Devices", `/settings/devices/${ids.car}`]);
    expect(inIndex("owntracks").map(([label]) => label)).toEqual(
      expect.arrayContaining(["Devices", "Car", "OwnTracks endpoint"]),
    );
    expect(inIndex("owntracks").map(([label]) => label)).not.toContain("iPhone 16");
    expect(inIndex("k3f9").map(([label]) => label)).toEqual(["iPhone 16"]);
    // Without its list, search knows no devices, only the page.
    expect(found("iphone 16")).toEqual([]);
    expect(found("devices")[0]).toEqual(["Devices", "Account", "/settings/devices"]);
    // A part of the Devices page, and adding one with the dialog open.
    expect(found("add device")[0]).toEqual([
      "Add device",
      "Account › Devices",
      "/settings/devices?add=1",
    ]);
    expect(found("uploads")[0]).toEqual([
      "Uploads",
      "Account › Devices",
      "/settings/devices#uploads",
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

  it("count the devices once they have loaded", () => {
    expect(settingsBadgeValue("devices", sources)).toBeNull();
    expect(settingsBadgeValue("devices", { ...sources, devices: [] })).toBeNull();
    expect(settingsBadgeValue("devices", { ...sources, devices: [device(), car()] })).toBe("2");
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
