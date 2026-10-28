import { setTimeout as sleep } from "node:timers/promises";

/** Waits until `check` holds, looking every 20 ms, or fails after `timeoutMs` naming `what`. */
export async function eventually(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`${what}: not within ${timeoutMs} ms`);
    await sleep(20);
  }
}
