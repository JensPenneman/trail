import type { Server } from "node:http";
import { type IncomingMessage, request } from "node:http";
import type { AddressInfo } from "node:net";
import { type ServerEvent, serverEventSchema } from "@trail/contracts/events";

/** A minimal EventSource for tests: collects parsed events from `GET /api/events`. */
export class SseClient {
  readonly events: ServerEvent[] = [];
  #response: IncomingMessage | undefined;
  #waiters: Array<() => void> = [];
  #ended: Promise<void> = new Promise(() => {});

  static async connect(server: Server, cookie: string): Promise<SseClient> {
    const client = new SseClient();
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/events",
          headers: { Cookie: cookie, Accept: "text/event-stream" },
        },
        (res) => {
          client.#response = res;
          if (res.statusCode !== 200) {
            reject(new Error(`SSE answered ${res.statusCode}`));
            return;
          }
          res.setEncoding("utf8");
          client.#ended = new Promise((ended) => res.once("end", () => ended()));
          let buffer = "";
          res.on("data", (chunk: string) => {
            buffer += chunk;
            let end = buffer.indexOf("\n\n");
            while (end >= 0) {
              client.#receive(buffer.slice(0, end));
              buffer = buffer.slice(end + 2);
              end = buffer.indexOf("\n\n");
            }
          });
          resolve();
        },
      );
      req.on("error", reject);
      req.end();
    });
    return client;
  }

  #receive(message: string): void {
    const data = message
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    if (data === "") return;
    this.events.push(serverEventSchema.parse(JSON.parse(data)));
    for (const wake of this.#waiters.splice(0)) wake();
  }

  /** Waits until an event of `type` has arrived (or fails after `timeoutMs`). */
  async waitFor<T extends ServerEvent["type"]>(
    type: T,
    timeoutMs = 5_000,
  ): Promise<Extract<ServerEvent, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(
        (event): event is Extract<ServerEvent, { type: T }> => event.type === type,
      );
      if (found !== undefined) return found;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`No "${type}" event within ${timeoutMs} ms`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.#waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Resolves when the server ends the stream. */
  ended(): Promise<void> {
    return this.#ended;
  }

  close(): void {
    this.#response?.destroy();
  }
}
