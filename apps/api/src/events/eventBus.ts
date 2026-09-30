import type { ServerEvent } from "@trail/contracts/events";

/** Told to a stream whose session is gone, right before it is closed. */
const sessionEnded: ServerEvent = { type: "session-ended" };

export interface EventSubscriber {
  /** Session behind the stream, so logout and revocation can cut it off. */
  sessionId: string;
  send: (event: ServerEvent) => void;
  close: () => void;
}

/**
 * In-process fan-out of live events to the SSE streams of one user (the app
 * runs as a single instance, docs/architecture.md §9).
 */
export class EventBus {
  readonly #byUser = new Map<string, Set<EventSubscriber>>();

  subscribe(userId: string, subscriber: EventSubscriber): () => void {
    let subscribers = this.#byUser.get(userId);
    if (subscribers === undefined) {
      subscribers = new Set();
      this.#byUser.set(userId, subscribers);
    }
    subscribers.add(subscriber);
    return () => {
      const current = this.#byUser.get(userId);
      current?.delete(subscriber);
      if (current?.size === 0) this.#byUser.delete(userId);
    };
  }

  connectionCount(userId: string): number {
    return this.#byUser.get(userId)?.size ?? 0;
  }

  publish(userId: string, event: ServerEvent): void {
    for (const subscriber of this.#byUser.get(userId) ?? []) subscriber.send(event);
  }

  /** Logout or revocation: the streams of that session learn why, then close. */
  disconnectSession(sessionId: string): void {
    for (const subscribers of this.#byUser.values()) {
      for (const subscriber of [...subscribers]) {
        if (subscriber.sessionId === sessionId) endSession(subscriber);
      }
    }
  }

  /** Account deletion: every stream of the user learns its session ended, then closes. */
  disconnectUser(userId: string): void {
    for (const subscriber of [...(this.#byUser.get(userId) ?? [])]) endSession(subscriber);
  }

  /** Shutdown: streams close without a reason, so clients reconnect to the next instance. */
  disconnectAll(): void {
    for (const subscribers of [...this.#byUser.values()]) {
      for (const subscriber of [...subscribers]) subscriber.close();
    }
  }
}

function endSession(subscriber: EventSubscriber): void {
  subscriber.send(sessionEnded);
  subscriber.close();
}
