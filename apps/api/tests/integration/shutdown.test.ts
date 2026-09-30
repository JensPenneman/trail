import { beforeAll, describe, expect, it } from "vitest";
import { shutdown } from "../../src/server/shutdown";
import { signUpWithCookie } from "../support/authFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SseClient } from "../support/sseClient";
import { createTestContext } from "../support/testContext";

beforeAll(async () => {
  await resetDatabase();
});

describe("graceful shutdown", () => {
  it("ends live streams, lets the server close promptly and closes the pool", async () => {
    // This context is consumed by the shutdown itself (its pool gets closed).
    const t = await createTestContext();
    const { cookie } = await signUpWithCookie(t.app, "first@example.com");
    const stream = await SseClient.connect(t.app, cookie);
    await stream.waitFor("hello");

    let jobsStopped = false;
    const started = Date.now();
    await shutdown({
      server: t.app,
      ctx: t.ctx,
      jobs: {
        stop: async () => {
          jobsStopped = true;
        },
      },
    });
    await stream.ended();
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(jobsStopped).toBe(true);
    expect(t.app.listening).toBe(false);
    expect(t.ctx.pool.ended).toBe(true);
  });
});
