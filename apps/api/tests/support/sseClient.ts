import type { Server } from "node:http";
import { type IncomingMessage, request } from "node:http";
import type { AddressInfo } from "node:net";
import { type ServerEvent, serverEventSchema } from "@trail/contracts/events";

/** How a stream comes back: `?after=` (a page's own reconnect) or `Last-Event-ID` (the browser's). */
export interface SseResume {
  after?: string;
  lastEventId?: string;
}

/** A minimal EventSource for tests: collects parsed events from `GET /api/events`. */
export class SseClient {
  readonly events: ServerEvent[] = [];
  /** The `id:` of each event, in step with `events` (undefined where a message had none). */
  readonly ids: (string | undefined)[] = [];
  /** The `retry:` the server asked for. */
  retryMs: number | undefined;
  #response: IncomingMessage | undefined;
  #waiters: Array<() => void> = [];
  #ended: Promise<void> = new Promise(() => {});

  static async connect(server: Server, cookie: string, resume: SseResume = {}): Promise<SseClient> {
    const client = new SseClient();
    const { port } = server.address() as AddressInfo;
    const query = resume.after === undefined ? "" : `?after=${encodeURIComponent(resume.after)}`;
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: `/api/events${query}`,
          headers: {
            Cookie: cookie,
            Accept: "text/event-stream",
            ...(resume.lastEventId === undefined ? {} : { "Last-Event-ID": resume.lastEventId }),
          },
        },
        (res) => {
          client.#response = res;
          if (res.statusCode !== 200) {
            const status = res.statusCode;
            const retryAfter = res.headers["retry-after"];
            res.resume();
            reject(
              new Error(
                `SSE answered ${status}${retryAfter === undefined ? "" : ` (Retry-After ${retryAfter})`}`,
              ),
            );
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
    const lines = message.split("\n");
    const retry = lines.find((line) => line.startsWith("retry: "));
    if (retry !== undefined) this.retryMs = Number(retry.slice(7));
    const data = lines
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    if (data === "") return;
    this.events.push(serverEventSchema.parse(JSON.parse(data)));
    this.ids.push(lines.find((line) => line.startsWith("id: "))?.slice(4));
    for (const wake of this.#waiters.splice(0)) wake();
  }

  /** The id of the newest event that had one: where this stream stands. */
  get lastId(): string | undefined {
    return this.ids.findLast((id) => id !== undefined);
  }

  /**
   * Waits until an event of `type` has arrived — among the events from index
   * `after` on, to wait for the next one — or fails after `timeoutMs`.
   */
  async waitFor<T extends ServerEvent["type"]>(
    type: T,
    timeoutMs = 5_000,
    after = 0,
  ): Promise<Extract<ServerEvent, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events
        .slice(after)
        .find((event): event is Extract<ServerEvent, { type: T }> => event.type === type);
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
