import type { IconName } from "../ui/iconPaths";

/*
 * Settings as a tree of pages (docs/architecture.md §14), in the style of the
 * iPhone's Settings app: groups of rows on the root, a page per row, and for
 * some pages a page per item (a passkey, a token). This file is the tree as
 * data — the root list, the sidebar, search, the routes, the signed-in paths
 * and the old addresses all come from it — and stays free of components and
 * requests, as the start-up code reads it.
 */

/** The colour of a row's icon tile. */
export type SettingsTone =
  | "indigo"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink"
  | "orange"
  | "red"
  | "gray";

type SettingsGroupId = "account" | "privacy" | "developer" | "app" | "admin";

export interface SettingsGroupInfo {
  id: SettingsGroupId;
  label: string;
  /** A line under the group's rows. */
  footer?: string;
}

/** A part of a page that search finds by its name: the page, or a heading on it (`anchor`). */
interface SettingsSearchRow {
  label: string;
  keywords?: readonly string[];
  /** The id of the heading it sits under: `/settings/<page>#<anchor>`. */
  anchor?: string;
}

/** Which value a row shows on its right (settingsBadges.ts). */
export type SettingsBadgeId =
  | "profile"
  | "passkeys"
  | "browsers"
  | "sharing"
  | "links"
  | "tokens"
  | "notifications"
  | "about";

/** A page one level deeper, one per item of its page (a passkey of Passkeys). */
interface SettingsDetailNode {
  id: string;
  /** A route pattern: `:name` stands for the item's id. */
  path: string;
  /** What one item is called, for a page whose item does not exist. */
  label: string;
}

interface SettingsNodeBase {
  id: string;
  group: SettingsGroupId;
  label: string;
  icon: IconName;
  tone: SettingsTone;
  /** Other words people search for it by. */
  keywords: readonly string[];
  /** Only administrators have it. */
  adminOnly: boolean;
  badge?: SettingsBadgeId;
}

/** A page of Settings, at `path`. */
export interface SettingsPageNode extends SettingsNodeBase {
  kind: "page";
  path: string;
  /** The line under the page's title. */
  description: string;
  /** Parts of the page that search lists on their own. */
  rows?: readonly SettingsSearchRow[];
  details?: readonly SettingsDetailNode[];
}

/** A row that leaves the app for a page the server serves itself. */
interface SettingsExternalNode extends SettingsNodeBase {
  kind: "external";
  href: string;
}

export type SettingsNode = SettingsPageNode | SettingsExternalNode;

export const settingsRootPath = "/settings";

const settingsGroups: readonly SettingsGroupInfo[] = [
  { id: "account", label: "Account" },
  { id: "privacy", label: "Privacy & data" },
  {
    id: "developer",
    label: "Developer",
    footer: "For scripts, apps and agents that use Trail on your behalf.",
  },
  { id: "app", label: "App" },
  { id: "admin", label: "Admin", footer: "Only administrators see these." },
];

/** Every row of the root list, in its order. */
export const settingsNodes = [
  {
    kind: "page",
    id: "profile",
    path: "/settings/profile",
    group: "account",
    label: "Profile",
    icon: "user",
    tone: "indigo",
    description: "Your name, and the time zone your days follow.",
    keywords: ["name", "display name", "email address", "time zone", "account"],
    adminOnly: false,
    badge: "profile",
    rows: [
      { label: "Display name", keywords: ["name"] },
      { label: "Time zone", keywords: ["timezone", "days", "today", "midnight"] },
    ],
  },
  {
    kind: "page",
    id: "passkeys",
    path: "/settings/passkeys",
    group: "account",
    label: "Passkeys",
    icon: "key",
    tone: "green",
    description:
      "How you sign in, without a password. A passkey works on the address it was made for.",
    keywords: ["sign in", "password", "password manager", "security key", "face id", "touch id"],
    adminOnly: false,
    badge: "passkeys",
    rows: [
      { label: "Add a passkey here" },
      {
        label: "Add a passkey on another device or address",
        anchor: "passkey-link",
        keywords: ["one-time link", "qr code", "another device", "other address"],
      },
    ],
    details: [{ id: "passkey", path: "/settings/passkeys/:passkeyId", label: "Passkey" }],
  },
  {
    kind: "page",
    id: "browsers",
    path: "/settings/browsers",
    group: "account",
    label: "Browsers",
    icon: "monitor",
    tone: "blue",
    description: "The browsers signed in to your account. Sign out any of them but this one.",
    keywords: ["sessions", "signed in", "sign out", "log out", "other browsers", "devices"],
    adminOnly: false,
    badge: "browsers",
    rows: [{ label: "Sign out everywhere else", keywords: ["sign out other browsers"] }],
  },
  {
    kind: "page",
    id: "sharing",
    path: "/settings/sharing",
    group: "privacy",
    label: "Sharing",
    icon: "users",
    tone: "green",
    description: "The people who see where you are, and what each of them sees.",
    keywords: ["share my location", "people", "family", "friends", "stop sharing", "find my"],
    adminOnly: false,
    badge: "sharing",
    rows: [
      { label: "Share my location" },
      { label: "You share with", anchor: "shares", keywords: ["stop sharing", "precision"] },
    ],
    details: [{ id: "share", path: "/settings/sharing/:shareId", label: "Share" }],
  },
  {
    kind: "page",
    id: "links",
    path: "/settings/links",
    group: "privacy",
    label: "Public links",
    icon: "link",
    tone: "teal",
    description:
      "Secret addresses that show your location to anyone who has them, without an account, until they end or you turn them off.",
    keywords: ["link", "qr code", "anyone", "without an account", "turn off", "visitors"],
    adminOnly: false,
    badge: "links",
    rows: [{ label: "Make a public link" }],
    details: [{ id: "link", path: "/settings/links/:linkId", label: "Public link" }],
  },
  {
    kind: "page",
    id: "viewers",
    path: "/settings/privacy/viewers",
    group: "privacy",
    label: "Who viewed you",
    icon: "eye",
    tone: "purple",
    description: "Who looked at your location, and how often.",
    keywords: ["who looked", "views", "visitors", "viewers", "watched", "privacy"],
    adminOnly: false,
  },
  {
    kind: "page",
    id: "access-log",
    path: "/settings/privacy/access-log",
    group: "privacy",
    label: "Access log",
    icon: "history",
    tone: "gray",
    description: "Every read of your data, and every change to who may see it.",
    keywords: ["audit", "log", "reads", "who read", "api calls", "mcp calls", "privacy"],
    adminOnly: false,
  },
  {
    kind: "page",
    id: "data",
    path: "/settings/data",
    group: "privacy",
    label: "Your data",
    icon: "database",
    tone: "orange",
    description: "Take your data with you, delete some of it, or delete your account.",
    keywords: ["export", "download", "geojson", "gpx", "csv", "delete", "remove", "erase"],
    adminOnly: false,
    rows: [
      { label: "Export", anchor: "export", keywords: ["download", "geojson", "gpx", "csv"] },
      { label: "Delete a period", anchor: "delete-period", keywords: ["delete points", "remove"] },
      { label: "Delete account", anchor: "delete-account", keywords: ["close account"] },
    ],
  },
  {
    kind: "page",
    id: "tokens",
    path: "/settings/tokens",
    group: "developer",
    label: "API tokens",
    icon: "code",
    tone: "gray",
    description:
      "Let a script, an app or an agent use the Trail API for you, with only the permissions and devices you give it.",
    keywords: ["api", "token", "trlk", "scripts", "home assistant", "roll", "revoke", "scopes"],
    adminOnly: false,
    badge: "tokens",
    rows: [{ label: "Create token", keywords: ["new token"] }],
    details: [{ id: "token", path: "/settings/tokens/:tokenId", label: "API token" }],
  },
  {
    kind: "page",
    id: "mcp",
    path: "/settings/mcp",
    group: "developer",
    label: "MCP",
    icon: "plug",
    tone: "pink",
    description: "Connect an agent to Trail's MCP server, so it can plan around where you are.",
    keywords: ["model context protocol", "agent", "tools", "connect"],
    adminOnly: false,
    rows: [
      { label: "Create an Agent token", keywords: ["agent template"] },
      { label: "Server address", anchor: "connect", keywords: ["mcp url", "authorization"] },
    ],
  },
  {
    kind: "external",
    id: "api-reference",
    href: "/docs",
    group: "developer",
    label: "API reference",
    icon: "book",
    tone: "blue",
    keywords: ["openapi", "documentation", "docs", "endpoints", "v1"],
    adminOnly: false,
  },
  {
    kind: "page",
    id: "preferences",
    path: "/settings/preferences",
    group: "app",
    label: "Preferences",
    icon: "settings",
    tone: "gray",
    description: "Defaults your account takes to every browser you sign in on.",
    keywords: ["defaults", "map style", "dark", "light", "satellite", "level", "own activity"],
    adminOnly: false,
    rows: [
      { label: "Map style", anchor: "map", keywords: ["dark", "light", "satellite", "auto"] },
      {
        label: "Detail of the tracks",
        anchor: "map",
        keywords: ["level", "raw", "averaged", "mapped", "transport"],
      },
      { label: "Your own activity", anchor: "access-log", keywords: ["access log"] },
    ],
  },
  {
    kind: "page",
    id: "notifications",
    path: "/settings/notifications",
    group: "app",
    label: "Notifications",
    icon: "bell",
    tone: "red",
    description: "Alerts when a device goes silent, sent through ntfy.",
    keywords: ["alerts", "ntfy", "silent", "push", "notify"],
    adminOnly: false,
    badge: "notifications",
    rows: [{ label: "Device alerts", anchor: "devices", keywords: ["silent device"] }],
  },
  {
    kind: "page",
    id: "about",
    path: "/settings/about",
    group: "app",
    label: "About",
    icon: "info",
    tone: "gray",
    description: "The version of Trail that runs here, and signing out.",
    keywords: ["version", "build", "commit", "receiver endpoint", "overland"],
    adminOnly: false,
    badge: "about",
    rows: [
      { label: "Sign out", keywords: ["log out"] },
      { label: "Receiver endpoint", keywords: ["ingest", "overland url"] },
    ],
  },
  {
    kind: "page",
    id: "accounts",
    path: "/settings/accounts",
    group: "admin",
    label: "Accounts",
    icon: "shield",
    tone: "orange",
    description: "Who has an account on this server, and invitations for new people.",
    keywords: ["invite", "invitations", "users", "people", "administrator"],
    adminOnly: true,
    rows: [
      { label: "Invite someone", anchor: "invite", keywords: ["invitation"] },
      { label: "Accounts on this server", anchor: "accounts", keywords: ["users"] },
    ],
  },
] as const satisfies readonly SettingsNode[];

type TreePage = Extract<(typeof settingsNodes)[number], { kind: "page" }>;

export type SettingsPageId = TreePage["id"];

/** The pages of single items, by id (`passkey`, `token`, …). */
export type SettingsDetailId = Extract<
  TreePage,
  { details: readonly unknown[] }
>["details"][number]["id"];

/** Every page of the root list, in its order (the external row is not a page). */
export const settingsPageNodes: readonly SettingsPageNode[] = settingsNodes.filter(
  (node): node is TreePage => node.kind === "page",
);
const pages = settingsPageNodes;

/** The page with `id`. */
export function settingsPage(id: SettingsPageId): SettingsPageNode {
  const page = pages.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`No Settings page ${id}`);
  return page;
}

/** Where `/settings` goes where the list stands beside the page: the first page. */
export const firstSettingsPath = settingsPage("profile").path;

/** The rows `isAdmin` sees, group by group, in their order. */
export function settingsGroupsFor(
  isAdmin: boolean,
): { group: SettingsGroupInfo; nodes: SettingsNode[] }[] {
  return settingsGroups
    .map((group) => ({
      group,
      nodes: settingsNodes.filter(
        (node: SettingsNode) => node.group === group.id && (isAdmin || !node.adminOnly),
      ),
    }))
    .filter((entry) => entry.nodes.length > 0);
}

/** A route pattern as a regular expression source: `:name` matches one path segment. */
const patternSource = (path: string): string =>
  path
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");

const trimmed = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

const matches = (path: string, pathname: string): boolean =>
  new RegExp(`^${patternSource(path)}$`).test(trimmed(pathname));

/** Addresses that moved, with where they lead now. */
export const settingsRedirects: readonly { from: string; to: string }[] = [
  // Accounts were `/settings/people` until People became the sharing page.
  { from: "/settings/people", to: settingsPage("accounts").path },
];

/** Every address of Settings, the old ones included, as a regular expression source. */
export function settingsPathsSource(): string {
  const paths = [
    settingsRootPath,
    ...pages.flatMap((page) => [page.path, ...(page.details ?? []).map((detail) => detail.path)]),
    ...settingsRedirects.map((redirect) => redirect.from),
  ];
  return `(?:${paths.map(patternSource).join("|")})`;
}

/**
 * Where an address sits in the tree: the root (0), a page (1) or the page of
 * one of its items (2) — so moving between them can look like going in or
 * coming back. The page is the one its row is for (a detail's own page).
 */
export function settingsPlaceOf(pathname: string): {
  level: 0 | 1 | 2;
  page: SettingsPageNode | undefined;
} {
  if (trimmed(pathname) === settingsRootPath) return { level: 0, page: undefined };
  for (const page of pages) {
    if (matches(page.path, pathname)) return { level: 1, page };
    if ((page.details ?? []).some((detail) => matches(detail.path, pathname))) {
      return { level: 2, page };
    }
  }
  return { level: 1, page: undefined };
}

/**
 * Where an anchor of the single Settings page of 0.2 (`/settings#tokens`)
 * lives now, and the id of a page as its own anchor. Lower case, and own keys
 * only: the prototype would answer `#__proto__` and `#constructor`.
 */
const anchors: Readonly<Record<string, { page: SettingsPageId; hash?: string }>> = {
  ...Object.fromEntries(pages.map((page) => [page.id, { page: page.id as SettingsPageId }])),
  link: { page: "passkeys", hash: "passkey-link" },
  "passkey-link": { page: "passkeys", hash: "passkey-link" },
  sessions: { page: "browsers" },
  "api-tokens": { page: "tokens" },
  people: { page: "accounts" },
  invites: { page: "accounts" },
  export: { page: "data", hash: "export" },
};

function anchorOf(hash: string): string {
  const raw = hash.replace(/^#/, "");
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/**
 * The page an anchor of `/settings` stands for (`#browsers` → Browsers), or
 * null when there is none for this person: then `/settings` itself shows.
 */
export function settingsPathFor(hash: string, isAdmin: boolean): string | null {
  const anchor = anchorOf(hash);
  const target = Object.hasOwn(anchors, anchor) ? anchors[anchor] : undefined;
  if (target === undefined) return null;
  const page = settingsPage(target.page);
  if (page.adminOnly && !isAdmin) return null;
  return `${page.path}${target.hash === undefined ? "" : `#${target.hash}`}`;
}
