import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationsFolder } from "./resetDatabase";

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

export const journal: Journal = JSON.parse(
  readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
);

/** A migrations folder holding the migrations up to and including `tag` (the first: the first release's). */
export function folderUpTo(tag?: string): string {
  const last = tag === undefined ? 0 : journal.entries.findIndex((entry) => entry.tag === tag);
  if (last < 0 || journal.entries.length === 0)
    throw new Error(`no migration ${tag} in the journal`);
  const entries = journal.entries.slice(0, last + 1);
  const folder = mkdtempSync(join(tmpdir(), "trail-migrations-"));
  mkdirSync(join(folder, "meta"));
  for (const entry of entries) {
    cpSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  return folder;
}

/** The tag of the migration named `name` (`0002_api_tokens`): numbers change on rebases, names do not. */
export function tagOf(name: string): string {
  const tag = journal.entries.find((entry) => entry.tag.endsWith(`_${name}`))?.tag;
  if (tag === undefined) throw new Error(`no migration named ${name} in the journal`);
  return tag;
}

/** The tag of the migration before the one named `name`. */
export function tagBefore(name: string): string {
  const index = journal.entries.findIndex((entry) => entry.tag === tagOf(name));
  const before = journal.entries[index - 1]?.tag;
  if (before === undefined) throw new Error(`no migration before ${name}`);
  return before;
}
