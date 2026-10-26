/* Installs the lefthook git hooks for local development. Skipped in CI, in
 * container builds and in the development container (.devcontainer): hooks
 * are pointless there or belong to the host's git, and git may refuse a
 * workspace owned by another user or, in the development container, find no
 * repository at all (a worktree's git directory is not mounted there). */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "false";
const inDevContainer = process.env["TRAIL_DEVCONTAINER"] !== undefined;
const hasRepo = existsSync(fileURLToPath(new URL("../.git", import.meta.url)));

if (inCi || inDevContainer || !hasRepo) {
  console.log("hooks: skipped (CI, development container or no git repository)");
} else {
  execFileSync("npx", ["lefthook", "install"], { stdio: "inherit" });
}
