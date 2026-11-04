import { describe, expect, it, vi } from "vitest";
import type { Database, Transaction } from "../../src/db/database";
import { correctionTransaction, stillProcessingMessage } from "../../src/processing/deviceLock";

/** A database whose transaction runs its body on a tx that records the statements and fails the Nth. */
function fakeDatabase(failAt: number | null, failure: unknown) {
  const statements: unknown[] = [];
  const tx = {
    execute: vi.fn(async (query: unknown) => {
      statements.push(query);
      if (statements.length === failAt) throw failure;
      return { rows: [] };
    }),
  };
  const db = {
    transaction: async (body: (t: Transaction) => Promise<unknown>) => body(tx as never),
  } as unknown as Database;
  return { db, tx };
}

describe("a correction's transaction", () => {
  it("bounds the wait, takes the lock, then runs its body", async () => {
    const { db, tx } = fakeDatabase(null, null);
    const result = await correctionTransaction(db, "device", async () => "done", 2500);
    expect(result).toBe("done");
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it("answers 409 with a message to try again when the lock stayed taken", async () => {
    const { db } = fakeDatabase(2, Object.assign(new Error("lock timeout"), { code: "55P03" }));
    await expect(correctionTransaction(db, "device", async () => "done")).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      message: stillProcessingMessage,
    });
  });

  it("finds the code behind a wrapper, and leaves other failures alone", async () => {
    const wrapped = new Error("query failed", {
      cause: Object.assign(new Error("lock timeout"), { code: "55P03" }),
    });
    const timedOut = fakeDatabase(2, wrapped);
    await expect(correctionTransaction(timedOut.db, "device", async () => 1)).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    const broken = fakeDatabase(2, new Error("connection lost"));
    await expect(correctionTransaction(broken.db, "device", async () => 1)).rejects.toThrow(
      "connection lost",
    );
  });
});
