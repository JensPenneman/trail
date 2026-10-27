import type { IconName } from "../ui/iconPaths";
import { type SettingsTone, settingsGroupsFor } from "./settingsTree";

/** One thing search can find: a page, a part of one, or the row that leaves the app. */
export interface SettingsSearchEntry {
  key: string;
  label: string;
  /** Where it is: the group for a page, "group › page" for a part of one. */
  trail: string;
  /** The address it opens (`/settings/data#export`), or the page outside the app. */
  to: string;
  external: boolean;
  icon: IconName;
  tone: SettingsTone;
  /** The label, folded (see `fold`). */
  name: string;
  /** Everything it is found by, folded: label, keywords, its page and group. */
  terms: string;
}

/** Lower case, without accents and punctuation, "&" as "and": what search compares. */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The index of the tree as `isAdmin` sees it: each page, then the parts of it, in tree order. */
export function settingsSearchIndex(isAdmin: boolean): SettingsSearchEntry[] {
  return settingsGroupsFor(isAdmin).flatMap(({ group, nodes }) =>
    nodes.flatMap((node) => {
      const page: SettingsSearchEntry = {
        key: node.id,
        label: node.label,
        trail: group.label,
        to: node.kind === "page" ? node.path : node.href,
        external: node.kind === "external",
        icon: node.icon,
        tone: node.tone,
        name: fold(node.label),
        terms: fold([node.label, ...node.keywords, group.label].join(" ")),
      };
      if (node.kind !== "page") return [page];
      const parts = (node.rows ?? []).map(
        (row, index): SettingsSearchEntry => ({
          key: `${node.id}:${index}`,
          label: row.label,
          trail: `${group.label} › ${node.label}`,
          to: row.anchor === undefined ? node.path : `${node.path}#${row.anchor}`,
          external: false,
          icon: node.icon,
          tone: node.tone,
          name: fold(row.label),
          terms: fold([row.label, ...(row.keywords ?? []), node.label, group.label].join(" ")),
        }),
      );
      return [page, ...parts];
    }),
  );
}

/** How well a label matches: lower is better; names that only match by keyword come last. */
function rank(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (` ${name}`.includes(` ${query}`)) return 2;
  if (name.includes(query)) return 3;
  return 4;
}

/**
 * The entries every word of `query` occurs in (anywhere in their terms), the
 * best matches of their label first and otherwise in the order of the tree.
 */
export function searchSettings(
  index: readonly SettingsSearchEntry[],
  query: string,
  limit = 20,
): SettingsSearchEntry[] {
  const folded = fold(query);
  if (folded === "") return [];
  const words = folded.split(" ");
  return index
    .map((entry, order) => ({ entry, order, rank: rank(entry.name, folded) }))
    .filter(({ entry }) => words.every((word) => entry.terms.includes(word)))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
