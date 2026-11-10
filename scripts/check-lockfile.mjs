/* Lints package-lock.json: every installed package must come from the npm
 * registry and carry an integrity hash. A git or tarball URL in the lockfile
 * would let a pull request (or a bot's lockfile change) pull code that the
 * registry's signatures and cooldowns never saw, and one without an integrity
 * hash is not verified when it is installed. Workspace sources and links are
 * local and have no `resolved`. Takes the lockfile's path as an optional
 * argument (the default is the repository's own). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REGISTRY = "https://registry.npmjs.org/";
const path = process.argv[2] ?? fileURLToPath(new URL("../package-lock.json", import.meta.url));
const lock = JSON.parse(readFileSync(path, "utf8"));

if (!lock.packages || typeof lock.packages !== "object") {
  console.error(`check-lockfile: ${path} has no "packages" (lockfileVersion 2 or newer needed)`);
  process.exit(1);
}

const problems = [];
for (const [key, entry] of Object.entries(lock.packages)) {
  // The root and the workspaces' own folders are local, not installed from a registry.
  if (key === "" || entry.link === true || !key.split("/").includes("node_modules")) continue;
  if (typeof entry.resolved !== "string" || !entry.resolved.startsWith(REGISTRY)) {
    problems.push(`${key}: resolved is ${JSON.stringify(entry.resolved)}, not under ${REGISTRY}`);
  }
  if (typeof entry.integrity !== "string" || entry.integrity === "") {
    problems.push(`${key}: no integrity`);
  }
}

if (problems.length > 0) {
  console.error(`check-lockfile: ${problems.length} problem(s) in ${path}`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `check-lockfile: ${Object.keys(lock.packages).length - 1} entries, all from ${REGISTRY} with integrity`,
);
