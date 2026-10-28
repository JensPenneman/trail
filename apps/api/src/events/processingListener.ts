import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import type { Logger } from "pino";
import type { EventBus } from "./eventBus";
import { decodeSegmentsNotice, processingChannel, type SegmentsNotice } from "./processingNotify";

/** A reconnect waits 1 s after a lost connection, then twice as long after each failure, at most 30 s. */
const firstRetryMs = 1_000;
const maxRetryMs = 30_000;
/** The connection is checked this often; a check unanswered this long counts as a lost connection. */
const checkEveryMs = 30_000;
const checkTimeoutMs = 10_000;
/** A clean stop waits this long for the server to say goodbye, then drops the socket. */
const endTimeoutMs = 2_000;
/**
 * Segments carry the start of their pass's transaction (`computed_at`), so
 * the catch-up after a reconnect reaches back this far before the moment the
 * connection was last known to work: a pass that began before the break and
 * committed while the listener was away is announced too.
 */
const catchUpMarginMs = 10 * 60_000;

/** Waits `ms`, or rejects when `signal` aborts (the listener stopped). */
type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

const wait: Wait = (ms, signal) => sleep(ms, undefined, { signal, ref: false });

interface CatchUpRow extends Record<string, unknown> {
  user_id: string;
  device_id: string;
  from_at: Date;
  to_at: Date;
}

const failure = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * The API's end of the processing channel (docs/architecture.md §9): one
 * connection of its own, outside the pool, that LISTENs on
 * `trail_processing` and republishes every `segments` message on the
 * in-process bus — whether the pass ran in a worker process or in this one.
 * A lost connection is opened again with backoff, and then a `segments`
 * event goes out for every device whose segments were worked out while it
 * was away, so a dashboard that stayed open still refetches.
 */
export class ProcessingListener {
  readonly #connectionString: string;
  readonly #bus: EventBus;
  readonly #logger: Logger;
  readonly #wait: Wait;
  readonly #abort = new AbortController();
  readonly #created = new Date();
  #client: pg.Client | null = null;
  #backendPid: number | null = null;
  /** The database's clock when the connection last answered. */
  #lastAlive: Date | null = null;
  #check: NodeJS.Timeout | undefined;
  #reconnecting: Promise<void> | null = null;
  #stopped = false;

  constructor(input: {
    connectionString: string;
    bus: EventBus;
    logger: Logger;
    /** The pause before a reconnect attempt (tests hold it). */
    wait?: Wait;
  }) {
    this.#connectionString = input.connectionString;
    this.#bus = input.bus;
    this.#logger = input.logger;
    this.#wait = input.wait ?? wait;
  }

  /** Whether the channel is listened to right now. */
  get listening(): boolean {
    return this.#client !== null;
  }

  /** The Postgres backend of the listening connection (as in `pg_stat_activity`), null while there is none. */
  get backendPid(): number | null {
    return this.#backendPid;
  }

  /** Listens; when the database cannot be reached it keeps trying in the background. */
  async start(): Promise<void> {
    if (this.#stopped || this.#client !== null || this.#reconnecting !== null) return;
    try {
      await this.#connect(null);
    } catch (error) {
      this.#logger.warn({ err: error }, "processing events not listened to yet; trying again");
      this.#reconnect(this.#created);
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#abort.abort();
    clearInterval(this.#check);
    const client = this.#client;
    this.#client = null;
    this.#backendPid = null;
    await this.#reconnecting;
    if (client === null) return;
    client.removeAllListeners();
    client.on("error", () => {});
    const ended = await Promise.race([
      client.end().then(
        () => true,
        () => false,
      ),
      sleep(endTimeoutMs, false, { ref: false }),
    ]);
    if (!ended) client.connection.stream.destroy();
  }

  /**
   * Opens a connection, listens and, after a lost one, announces what was
   * worked out since `missedSince`. LISTEN comes first, so nothing committed
   * after the catch-up's read is missed; what commits between the two is
   * announced twice, which costs a dashboard one more refetch.
   */
  async #connect(missedSince: Date | null): Promise<number> {
    const client = new pg.Client({
      connectionString: this.#connectionString,
      application_name: "trail-listener",
      options: "-c TimeZone=UTC",
      connectionTimeoutMillis: 5_000,
      keepAlive: true,
    });
    client.on("error", (error) => this.#lost(client, error));
    client.on("end", () => this.#lost(client, null));
    client.on("notification", (message) => {
      if (message.channel === processingChannel && message.payload !== undefined) {
        this.#receive(message.payload);
      }
    });
    let caughtUp = 0;
    try {
      await client.connect();
      await client.query(`LISTEN ${processingChannel}`);
      const alive = await client.query<{ now: Date; pid: number }>(
        "SELECT now() AS now, pg_backend_pid() AS pid",
      );
      if (missedSince !== null) caughtUp = await this.#catchUp(client, missedSince);
      if (this.#stopped) throw new Error("the listener stopped");
      this.#client = client;
      this.#backendPid = alive.rows[0]?.pid ?? null;
      this.#lastAlive = alive.rows[0]?.now ?? null;
    } catch (error) {
      this.#drop(client);
      throw error;
    }
    this.#check = setInterval(() => void this.#checkConnection(client), checkEveryMs);
    this.#check.unref();
    this.#logger.debug({ pid: this.#backendPid }, "processing events listened to");
    return caughtUp;
  }

  #receive(payload: string): void {
    const notice = decodeSegmentsNotice(payload);
    if (notice === null) {
      this.#logger.debug("processing events: a message of another kind was left alone");
      return;
    }
    this.#publish(notice);
  }

  #publish(notice: SegmentsNotice): void {
    this.#bus.publish(notice.userId, {
      type: "segments",
      deviceId: notice.deviceId,
      from: notice.from.toISOString(),
      to: notice.to.toISOString(),
    });
  }

  /** One `segments` event per device whose segments were worked out since `since` (less the margin). */
  async #catchUp(client: pg.Client, since: Date): Promise<number> {
    const result = await client.query<CatchUpRow>(
      `SELECT d.user_id, s.device_id, min(s.started_at) AS from_at, max(s.ended_at) AS to_at
       FROM segments s
       JOIN devices d ON d.id = s.device_id
       WHERE s.computed_at > $1
       GROUP BY d.user_id, s.device_id`,
      [new Date(since.getTime() - catchUpMarginMs)],
    );
    for (const row of result.rows) {
      this.#publish({
        userId: row.user_id,
        deviceId: row.device_id,
        from: row.from_at,
        to: row.to_at,
      });
    }
    return result.rows.length;
  }

  async #checkConnection(client: pg.Client): Promise<void> {
    if (client !== this.#client) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      const answered = await Promise.race([
        client.query<{ now: Date }>("SELECT now() AS now"),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`no answer within ${checkTimeoutMs} ms`)),
            checkTimeoutMs,
          );
        }),
      ]);
      if (client === this.#client) this.#lastAlive = answered.rows[0]?.now ?? this.#lastAlive;
    } catch (error) {
      this.#lost(client, failure(error));
    } finally {
      clearTimeout(timer);
    }
  }

  /** The connection broke (the server ended it, the network, an unanswered check): reconnect. */
  #lost(client: pg.Client, error: Error | null): void {
    if (client !== this.#client) return;
    this.#client = null;
    this.#backendPid = null;
    clearInterval(this.#check);
    this.#drop(client);
    if (this.#stopped) return;
    this.#logger.warn(
      error === null ? {} : { err: error },
      "processing events: connection lost; reconnecting",
    );
    this.#reconnect(this.#lastAlive ?? this.#created);
  }

  /** Lets go of a connection without waiting for it: a half-open socket would never answer. */
  #drop(client: pg.Client): void {
    client.removeAllListeners();
    client.on("error", () => {});
    client.connection.stream.destroy();
  }

  #reconnect(missedSince: Date): void {
    if (this.#reconnecting !== null || this.#stopped) return;
    this.#reconnecting = (async () => {
      let delayMs = firstRetryMs;
      for (let attempt = 1; !this.#stopped; attempt += 1) {
        try {
          await this.#wait(delayMs, this.#abort.signal);
        } catch {
          return;
        }
        if (this.#stopped) return;
        try {
          const caughtUp = await this.#connect(missedSince);
          this.#logger.info({ attempts: attempt, caughtUp }, "processing events listened to again");
          return;
        } catch (error) {
          if (this.#stopped) return;
          this.#logger.warn(
            { err: error, attempt },
            "processing events: reconnecting failed; trying again",
          );
          delayMs = Math.min(delayMs * 2, maxRetryMs);
        }
      }
    })().finally(() => {
      this.#reconnecting = null;
    });
  }
}
