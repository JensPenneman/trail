/* Installs the lefthook git hooks for local development. Skipped in CI and in
 * container builds: hooks are pointless there, and git may refuse a workspace
 * owned by another user. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "false";
const hasRepo = existsSync(fileURLToPath(new URL("../.git", import.meta.url)));

if (inCi || !hasRepo) {
  console.log("hooks: skipped (CI or no git repository)");
} else {
  execFileSync("npx", ["lefthook", "install"], { stdio: "inherit" });
}
