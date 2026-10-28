import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openCliContext } from "../../src/cli/cliContext";
import { mapRefreshCommand } from "../../src/cli/commands/mapRefreshCommand";
import { runCli } from "../../src/cli/runCli";
import { MapDataRefresher } from "../../src/mapdata/mapDataRefresher";
import { RegistryClient } from "../../src/mapdata/registry";
import { FakeRegistry, makeArtefact, monacoFiles } from "../support/fakeRegistry";
import { resetDatabase } from "../support/resetDatabase";
import { testEnvironment } from "../support/testEnvironment";

/** The CLI entry lives in src/, one level above the migrations (like dist/ in the image). */
const entryUrl = new URL("../../src/cli.ts", import.meta.url).href;

let output: string[] = [];
let errors: string[] = [];
let root: string;
const saved = { ...process.env };

beforeAll(async () => {
  await resetDatabase();
  root = await mkdtemp(join(tmpdir(), "trail-map-cli-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

function useEnvironment(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(testEnvironment(overrides))) process.env[key] = value;
}

function captureConsole(): void {
  output = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    output.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.map(String).join(" "));
  });
}

const run = async (...argv: string[]) => {
  captureConsole();
  return runCli(argv, entryUrl);
};

describe("trail map", () => {
  it("checks its arguments before anything else", async () => {
    useEnvironment({});
    expect(await run("map")).toBe(2);
    expect(errors.join("\n")).toContain("map needs a command");
    expect(await run("map", "frobnicate")).toBe(2);
    expect(errors.join("\n")).toContain('unknown map command "frobnicate"');
    expect(await run("map", "refresh", "belgium", "netherlands")).toBe(2);
    expect(await run("map", "refresh", "../etc")).toBe(2);
    expect(await run("map", "status", "--all")).toBe(2);
  });

  it("has nothing to refresh without MAP_DATA_REGIONS", async () => {
    useEnvironment({ MAP_DATA_REGIONS: "", MAP_DATA_DIR: root });
    expect(await run("map", "refresh")).toBe(1);
    expect(errors.join("\n")).toContain("MAP_DATA_REGIONS is empty");
    expect(await run("map", "status")).toBe(0);
    expect(output[0]).toContain("No map regions configured (MAP_DATA_REGIONS is empty)");
  });

  it("refreshes only this server's regions", async () => {
    useEnvironment({ MAP_DATA_REGIONS: "monaco", MAP_DATA_DIR: root });
    expect(await run("map", "refresh", "luxembourg")).toBe(2);
    expect(errors.join("\n")).toContain("luxembourg is not one of this server's regions: monaco");
  });

  it("refreshes from the registry and lists the builds on the volume with their digests", async () => {
    const fake = await new FakeRegistry().start();
    try {
      const artefact = makeArtefact({
        region: "monaco",
        buildId: "20261027",
        files: monacoFiles(),
      });
      fake.publish(artefact);
      const name = `20261027-${artefact.digest.slice(7, 15)}`;
      useEnvironment({ MAP_DATA_REGIONS: "monaco", MAP_DATA_DIR: root });
      const ctx = await openCliContext(entryUrl);
      try {
        const refresher = new MapDataRefresher({
          settings: ctx.config.mapData,
          pool: ctx.db.$client,
          logger: ctx.logger,
          tables: null,
          client: new RegistryClient({
            reference: { host: fake.host, repository: fake.repository },
            credentials: null,
            logger: ctx.logger,
            scheme: "http",
            blobHosts: [fake.blobHost],
          }),
          pull: { freeBytes: async () => 1e12 },
        });
        captureConsole();
        // Only Monaco is in the fake registry: the world overview is refused, and says so.
        await expect(mapRefreshCommand(ctx, undefined, refresher)).rejects.toThrow(
          "1 of 2 regions were not refreshed",
        );
        expect(output).toEqual([
          expect.stringMatching(
            new RegExp(
              `^monaco: pulled build ${name}, 0\\.7 MB in [\\d.]+ s \\(${artefact.digest}\\)$`,
            ),
          ),
          "  not imported: this version of Trail has no map data loader yet",
          "world: no build",
          expect.stringMatching(/^ {2}failed \(registry, not_found\): .*:world does not exist$/),
        ]);
        captureConsole();
        await mapRefreshCommand(ctx, "monaco", refresher);
        expect(output[0]).toBe(`monaco: build ${name} is the registry's (${artefact.digest})`);
      } finally {
        await ctx.close();
      }

      // A region left on the volume that the configuration no longer names
      await mkdir(join(root, "regions", "netherlands"), { recursive: true });
      expect(await run("map", "status")).toBe(0);
      const text = output.join("\n");
      expect(text).toContain("Map data: monaco, world from ghcr.io/jenspenneman/trail-mapdata");
      // The refresh above ran without the loader; the tables are this version's, and empty.
      expect(text).toContain("Map tables: no region builds yet");
      expect(text).toContain("monaco: 1 on the volume");
      expect(text).toContain(`  ${name}: 0.7 MB, pulled `);
      expect(text).toContain(", OSM data up to 2026-10-27 21:23 UTC");
      expect(text).toContain(`    ${artefact.digest}`);
      expect(text).toContain("world: no build on the volume yet");
      expect(text).toContain("netherlands (not in MAP_DATA_REGIONS): no build on the volume yet");
    } finally {
      await fake.close();
    }
  });
});
