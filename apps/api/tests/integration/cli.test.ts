import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/runCli";
import { agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testEnvironment } from "../support/testEnvironment";

/** The CLI entry lives in src/, one level above the migrations (like dist/ in the image). */
const entryUrl = new URL("../../src/cli.ts", import.meta.url).href;

let t: TestContext;
let output: string[] = [];
let errors: string[] = [];

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  const agent = agentFor(t.app);
  await signUp(agent, new SoftwareAuthenticator(), "first@example.com");
  const device = await createDevice(agent, { name: "iPhone" });
  await postOverland(t.app, device.credentials.accessToken, overlandFixture()).expect(200);
  for (const [key, value] of Object.entries(testEnvironment())) process.env[key] = value;
});

afterAll(async () => {
  await t.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const run = async (...argv: string[]) => {
  output = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    output.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "table").mockImplementation((rows: unknown) => {
    output.push(JSON.stringify(rows));
  });
  return runCli(argv, entryUrl);
};

describe("trail CLI", () => {
  it("prints help", async () => {
    expect(await run("--help")).toBe(0);
    expect(output.join("\n")).toContain("Usage: trail <command>");
    expect(await run()).toBe(2);
    expect(errors.join("\n")).toContain("Usage: trail <command>");
  });

  it("rejects unknown commands and options with exit code 2", async () => {
    expect(await run("frobnicate")).toBe(2);
    expect(errors.join("\n")).toContain('unknown command "frobnicate"');
    expect(await run("users", "--everything")).toBe(2);
    expect(await run("invite", "--days", "99")).toBe(2);
    expect(await run("invite", "--email", "not-an-address")).toBe(2);
    expect(await run("passkey-link")).toBe(2);
    expect(await run("recompute", "--device", "nope")).toBe(2);
  });

  it("migrates", async () => {
    expect(await run("migrate")).toBe(0);
    expect(output).toEqual(["Database schema is up to date."]);
  });

  it("lists users", async () => {
    expect(await run("users")).toBe(0);
    expect(output.join("\n")).toContain("first@example.com");
  });

  it("creates invites", async () => {
    expect(await run("invite", "--email", "Friend@Example.com", "--days", "3")).toBe(0);
    expect(output.join("\n")).toMatch(/http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}/);
    expect(output[0]).toBe("Invite link for friend@example.com:");
  });

  it("creates recovery passkey links for existing accounts only", async () => {
    expect(
      await run("passkey-link", "first@example.com", "--origin", "http://trail.localhost:8080"),
    ).toBe(0);
    expect(output.join("\n")).toMatch(/http:\/\/trail\.localhost:8080\/link\/[A-Za-z0-9_-]{43}/);
    expect(await run("passkey-link", "ghost@example.com")).toBe(1);
    expect(errors.join("\n")).toContain("No account uses ghost@example.com");
    expect(await run("passkey-link", "first@example.com", "--origin", "https://evil.example")).toBe(
      2,
    );
  });

  it("rebuilds derived data and prunes", async () => {
    expect(await run("recompute")).toBe(0);
    expect(output.join("\n")).toContain("heat cells rebuilt, 1 days of statistics");
    expect(await run("prune")).toBe(0);
    expect(output[0]).toBe("Removed:");
  });

  it("reprocesses the history, a device or a range, at a level", async () => {
    expect(await run("reprocess", "--device", "nope")).toBe(2);
    expect(await run("reprocess", "--from", "2026-09-29T00:00:00Z")).toBe(2);
    expect(errors.join("\n")).toContain("--from and --to go together");
    expect(await run("reprocess", "--from-level", "raw")).toBe(2);
    expect(
      await run("reprocess", "--from", "2026-09-30T00:00:00Z", "--to", "2026-09-29T00:00:00Z"),
    ).toBe(2);

    expect(await run("reprocess")).toBe(0);
    expect(output.join("\n")).toMatch(
      /^iPhone \([0-9a-f-]{36}\): 1 windows, 30 points, 1 stops and moves$/,
    );
    const segments = await t.ctx.db.execute<{ mode_inferred: string }>(sql`
      SELECT mode_inferred FROM segments WHERE kind = 'move'
    `);
    expect(segments.rows).toEqual([{ mode_inferred: "cycling" }]);
    const queue = await t.ctx.db.execute(sql`SELECT 1 FROM processing_queue`);
    expect(queue.rows).toHaveLength(0);

    const [device] = (await t.ctx.db.execute<{ id: string }>(sql`SELECT id FROM devices`)).rows;
    expect(
      await run(
        "reprocess",
        "--device",
        device?.id ?? "",
        "--from",
        "2026-09-29T06:00:00Z",
        "--to",
        "2026-09-29T08:00:00Z",
        "--from-level",
        "inferred",
      ),
    ).toBe(0);
    expect(output.join("\n")).toContain("1 stops and moves");
    expect(await run("reprocess", "--device", "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3")).toBe(1);
  });

  it("fails with exit code 1 on configuration errors", async () => {
    const saved = process.env["PUBLIC_URL"];
    process.env["PUBLIC_URL"] = "not a url";
    try {
      expect(await run("users")).toBe(1);
      expect(errors.join("\n")).toContain("PUBLIC_URL");
    } finally {
      process.env["PUBLIC_URL"] = saved;
    }
  });
});
