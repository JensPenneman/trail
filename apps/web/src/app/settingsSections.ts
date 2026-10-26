/**
 * The sections of Settings, each an address of its own
 * (`/settings/<section>`, docs/architecture.md §14), in the order of their
 * navigation. `adminOnly` sections exist for administrators only.
 */
export const settingsSections = [
  { id: "profile", label: "Profile", adminOnly: false },
  { id: "passkeys", label: "Passkeys", adminOnly: false },
  { id: "tokens", label: "API tokens", adminOnly: false },
  { id: "sharing", label: "Sharing", adminOnly: false },
  { id: "people", label: "Accounts", adminOnly: true },
  { id: "data", label: "Data", adminOnly: false },
  { id: "about", label: "About", adminOnly: false },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];

/**
 * Where an anchor of the single Settings page of old (`/settings#tokens`) lives
 * now: the section, and the heading inside it when that is not the first.
 */
const anchors: Readonly<Record<string, { section: SettingsSection; hash?: string }>> = {
  profile: { section: "profile" },
  passkeys: { section: "passkeys" },
  link: { section: "passkeys", hash: "passkey-link" },
  "passkey-link": { section: "passkeys", hash: "passkey-link" },
  sessions: { section: "passkeys", hash: "browsers" },
  browsers: { section: "passkeys", hash: "browsers" },
  tokens: { section: "tokens" },
  "api-tokens": { section: "tokens" },
  sharing: { section: "sharing" },
  links: { section: "sharing" },
  people: { section: "people" },
  accounts: { section: "people" },
  invites: { section: "people" },
  data: { section: "data" },
  about: { section: "about" },
};

function anchorOf(hash: string): string {
  const raw = hash.replace(/^#/, "");
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** The address for `/settings` with `hash`: an old anchor's section, else Profile. */
export function settingsPathFor(hash: string, isAdmin: boolean): string {
  const target = anchors[anchorOf(hash)];
  if (target === undefined || (target.section === "people" && !isAdmin)) {
    return "/settings/profile";
  }
  return `/settings/${target.section}${target.hash === undefined ? "" : `#${target.hash}`}`;
}
