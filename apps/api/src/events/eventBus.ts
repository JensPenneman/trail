import type { ServerEvent } from "@trail/contracts/events";
import type { Logger } from "pino";
import { EventRing, ringLimits } from "./eventRing";
import { formatServerEvent } from "./formatServerEvent";

/** Told to a stream whose session is gone, right before it is closed. */
const sessionEnded: ServerEvent = { type: "session-ended" };

/** Every open stream is pinged, and its session checked, this often (proxies drop idle streams after ~100 s). */
const tickMs = 20_000;
/** Rings without a stream are looked at this often, and dropped once nothing in them could be replayed. */
const sweepMs = 30_000;

export interface EventSubscriber {
  /** Session behind the stream, so logout and revocation can cut it off. */
  sessionId: string;
  /** `message` is the event as an SSE message, with its id in the user's stream. */
  send: (event: ServerEvent, message: string) => void;
  /** The keep-alive of every tick. */
  ping?: () => void;
  close: () => void;
}

/** A stream's place in its user's events, as `subscribe` hands it out. */
export interface Subscription {
  unsubscribe: () => void;
  /** The id the stream starts at: its `hello`'s (and its `resync`'s). */
  position: string;
  /** The messages a stream opened `after` an id missed, oldest first; null when they are gone (resync). */
  missed: readonly string[] | null;
}

interface HeldRing {
  ring: EventRing;
  /** When the user's last stream closed; null while one is open. */
  idleSince: number | null;
}

/**
 * The fan-out of live events to the SSE streams of one user, in the API's own
 * process (docs/architecture.md §9): what the API does publishes here, and a
 * processing pass, in whichever process it ran, arrives through NOTIFY and the
 * processing listener, which publishes it here like any other. Every event of a user
 * gets an id in their ring, which keeps the last ones (`EventRing`) while a
 * stream is open and two minutes after the last one closed, so a stream that
 * comes back with the id it saw last gets what it missed. Every tick pings
 * every stream and re-checks all their sessions in one statement.
 */
export class EventBus {
  readonly #byUser = new Map<string, Set<EventSubscriber>>();
  readonly #rings = new Map<string, HeldRing>();
  readonly #activeSessions: ((ids: readonly string[]) => Promise<ReadonlySet<string>>) | null;
  readonly #logger: Logger | null;
  readonly #now: () => number;
  #tick: NodeJS.Timeout | undefined;
  #sweep: NodeJS.Timeout | undefined;
  #checking = false;

  constructor(
    options: {
      /** Which of the sessions still stand; without it, sessions are not re-checked (unit tests). */
      activeSessions?: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
      logger?: Logger;
      now?: () => number;
    } = {},
  ) {
    this.#activeSessions = options.activeSessions ?? null;
    this.#logger = options.logger ?? null;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Adds a stream of the user. With `after` — the id the stream saw last —
   * it is owed the events since, or a resync when the ring no longer holds
   * them (another process, a dropped ring, too long ago). Synchronous with the
   * caller's first writes: nothing is published in between.
   */
  subscribe(userId: string, subscriber: EventSubscriber, after?: string): Subscription {
    const now = this.#now();
    let held = this.#rings.get(userId);
    if (held === undefined) {
      held = { ring: new EventRing(), idleSince: null };
      this.#rings.set(userId, held);
    }
    held.idleSince = null;
    const replay = after === undefined ? [] : held.ring.since(after, now);
    let subscribers = this.#byUser.get(userId);
    if (subscribers === undefined) {
      subscribers = new Set();
      this.#byUser.set(userId, subscribers);
    }
    subscribers.add(subscriber);
    this.#startTicking();
    return {
      unsubscribe: () => this.#unsubscribe(userId, subscriber),
      // A resumed stream stands where it was: the missed events carry their own ids.
      position: after !== undefined && replay !== null ? after : held.ring.position,
      missed: replay === null ? null : replay.map((entry) => entry.message),
    };
  }

  /**
   * Whether the user's events are kept: a stream of theirs is open, or closed
   * within the last two minutes and may come back for what it missed.
   */
  follows(userId: string): boolean {
    return this.#rings.has(userId);
  }

  connectionCount(userId: string): number {
    return this.#byUser.get(userId)?.size ?? 0;
  }

  /** Every open stream of every user (the global cap of §9, the load line). */
  streamCount(): number {
    let total = 0;
    for (const subscribers of this.#byUser.values()) total += subscribers.size;
    return total;
  }

  /** Numbers the event in the user's ring and sends it to their streams; nobody listening, nothing kept. */
  publish(userId: string, event: ServerEvent): void {
    const held = this.#rings.get(userId);
    if (held === undefined) return;
    const entry = held.ring.push((id) => formatServerEvent(event, id), this.#now());
    for (const subscriber of this.#byUser.get(userId) ?? []) subscriber.send(event, entry.message);
  }

  /**
   * An event the user would have been sent had a stream been open, which is
   * not kept: their stream that comes back from before it resyncs instead of
   * missing it (a `person` event, which is only pushed to an open page).
   */
  miss(userId: string): void {
    this.#rings.get(userId)?.ring.skip();
  }

  /** Logout or revocation: the streams of that session learn why, then close. */
  disconnectSession(sessionId: string): void {
    for (const subscribers of [...this.#byUser.values()]) {
      for (const subscriber of [...subscribers]) {
        if (subscriber.sessionId === sessionId) endSession(subscriber);
      }
    }
  }

  /** Account deletion: every stream of the user learns its session ended, then closes. */
  disconnectUser(userId: string): void {
    for (const subscriber of [...(this.#byUser.get(userId) ?? [])]) endSession(subscriber);
    this.#rings.delete(userId);
  }

  /** Shutdown: streams close without a reason, so clients reconnect to the next instance. */
  disconnectAll(): void {
    for (const subscribers of [...this.#byUser.values()]) {
      for (const subscriber of [...subscribers]) subscriber.close();
    }
    this.#rings.clear();
    clearInterval(this.#tick);
    clearInterval(this.#sweep);
    this.#tick = undefined;
    this.#sweep = undefined;
  }

  /**
   * One tick: a ping to every stream, then one statement for all their
   * sessions; the streams of a session that ended learn it and close. A
   * check still running when the next tick comes is not doubled. Returns
   * whether this tick checked the sessions (not without a check, without a
   * stream, or while another check runs).
   */
  async tick(): Promise<boolean> {
    const sessions = new Set<string>();
    for (const subscribers of [...this.#byUser.values()]) {
      for (const subscriber of [...subscribers]) {
        subscriber.ping?.();
        sessions.add(subscriber.sessionId);
      }
    }
    if (this.#activeSessions === null || this.#checking || sessions.size === 0) return false;
    this.#checking = true;
    try {
      const active = await this.#activeSessions([...sessions]);
      for (const subscribers of [...this.#byUser.values()]) {
        for (const subscriber of [...subscribers]) {
          // A stream opened during the check was not asked about: the next tick checks it.
          if (sessions.has(subscriber.sessionId) && !active.has(subscriber.sessionId)) {
            endSession(subscriber);
          }
        }
      }
    } catch (error) {
      this.#logger?.warn({ err: error }, "could not re-check the sessions of the live streams");
    } finally {
      this.#checking = false;
    }
    return true;
  }

  /** Drops the rings whose user has had no stream for longer than a ring keeps an event. */
  sweep(): void {
    const now = this.#now();
    for (const [userId, held] of this.#rings) {
      if (held.idleSince !== null && now - held.idleSince > ringLimits.ageMs) {
        this.#rings.delete(userId);
      }
    }
    if (![...this.#rings.values()].some((held) => held.idleSince !== null)) {
      clearInterval(this.#sweep);
      this.#sweep = undefined;
    }
  }

  /** Rings held, and the characters they keep (memory, roughly bytes). */
  ringUsage(): { rings: number; chars: number } {
    let chars = 0;
    for (const held of this.#rings.values()) chars += held.ring.size;
    return { rings: this.#rings.size, chars };
  }

  #unsubscribe(userId: string, subscriber: EventSubscriber): void {
    const current = this.#byUser.get(userId);
    current?.delete(subscriber);
    if (current?.size !== 0) return;
    this.#byUser.delete(userId);
    const held = this.#rings.get(userId);
    if (held !== undefined) held.idleSince = this.#now();
    if (this.#sweep === undefined) {
      this.#sweep = setInterval(() => this.sweep(), sweepMs);
      this.#sweep.unref();
    }
    if (this.#byUser.size === 0) {
      clearInterval(this.#tick);
      this.#tick = undefined;
    }
  }

  #startTicking(): void {
    if (this.#tick !== undefined) return;
    this.#tick = setInterval(() => void this.tick(), tickMs);
    this.#tick.unref();
  }
}

function endSession(subscriber: EventSubscriber): void {
  subscriber.send(sessionEnded, formatServerEvent(sessionEnded));
  subscriber.close();
}
