/* Starts the built server (apps/api/dist/main.mjs) for the Playwright suite on a
 * clean database: the E2E database's schemas are dropped in one transaction and
 * the app migrates them again on boot, so every run starts from nothing. Only a
 * database whose name marks it as the E2E suite's (trail…e2e) is ever touched.
 * The map data volume is laid out afresh too: the Monaco fixture's basemap as
 * a build the registry client would have pulled, so the map draws real tiles
 * from the server (docs/design/self-hosted-maps.md §4.4); only a directory
 * named trail-e2e-map is ever emptied. playwright.config.ts passes the whole
 * environment, DATABASE_URL and MAP_DATA_DIR included. */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const serverEntry = new URL("../apps/api/dist/main.mjs", import.meta.url);
const webIndex = new URL("../apps/web/dist/index.html", import.meta.url);
const monaco = fileURLToPath(new URL("../apps/api/tests/fixtures/mapdata/monaco", import.meta.url));
const e2eDatabaseName = /^trail.*e2e/;

/** @param {string} message */
function fail(message) {
  console.error(`e2e-server: ${message}`);
  process.exit(1);
}

for (const file of [serverEntry, webIndex]) {
  if (!existsSync(file)) fail(`${fileURLToPath(file)} is missing — run \`npm run build\` first`);
}

const connectionString = process.env["DATABASE_URL"] ?? "";
const url = URL.parse(connectionString);
const name = url === null ? "" : decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!/^postgres(ql)?:$/.test(url?.protocol ?? "") || !e2eDatabaseName.test(name)) {
  fail(
    `refusing to reset "${name}": E2E_DATABASE_URL must be a postgres:// URL of a trail…e2e database`,
  );
}

/** A database container may still be starting; a local database may be down. */
async function connect() {
  for (let attempt = 1; ; attempt += 1) {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= 30) throw error;
      await sleep(1_000);
    }
  }
}

const client = await connect();
try {
  // A server of an earlier run that is still attached would block the drop forever.
  await client.query("SET lock_timeout = '10s'");
  await client.query("BEGIN");
  await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("COMMIT");
} catch (error) {
  await client.end();
  fail(`could not reset "${name}": ${error instanceof Error ? error.message : String(error)}`);
}
await client.end();

const mapDataDir = process.env["MAP_DATA_DIR"] ?? "";
if (basename(mapDataDir) !== "trail-e2e-map") {
  fail(`refusing to empty "${mapDataDir}": MAP_DATA_DIR must be a directory named trail-e2e-map`);
}
rmSync(mapDataDir, { recursive: true, force: true });
// What the registry served, made up: its SHA-256 is the build's digest and names its directory.
const ociManifest = Buffer.from(
  `${JSON.stringify({ schemaVersion: 2, annotations: { region: "monaco", build: "20261027", e2e: true } })}\n`,
);
const digest = createHash("sha256").update(ociManifest).digest("hex");
const build = join(mapDataDir, "regions", "monaco", `20261027-${digest.slice(0, 8)}`);
mkdirSync(build, { recursive: true });
for (const file of ["basemap.pmtiles", "manifest.json"]) {
  copyFileSync(join(monaco, file), join(build, file));
}
writeFileSync(join(build, "oci-manifest.json"), ociManifest);

// The built server itself, in this process: it handles SIGTERM with its graceful shutdown.
await import(serverEntry.href);
