import { randomBytes } from "node:crypto";

/** One event as a user's streams got it: its id and its SSE message. */
export interface RingEntry {
  readonly seq: number;
  readonly message: string;
  /** When it was published (epoch ms). */
  readonly at: number;
}

/** How much one user's ring keeps (docs/architecture.md §9). */
export interface RingLimits {
  events: number;
  ageMs: number;
  /** The messages' characters: an upload's `ingest` event carries up to 500 points. */
  chars: number;
}

export const ringLimits: RingLimits = { events: 256, ageMs: 120_000, chars: 262_144 };

/**
 * The last events of one user, numbered, so a stream that comes back can be
 * given what it missed (docs/architecture.md §9). Ids are `<key>:<seq>`: the
 * key is random for every ring, so an id of another process — or of a ring
 * dropped since — is never taken for one of this ring's, and the sequence
 * counts this ring's events. The ring keeps a run without holes: an event
 * leaves it oldest first, by count, age or size, and an id from before what
 * is left cannot resume (`since` answers null). An event too large for a
 * quarter of the budget is not kept: it empties the ring, and only a stream
 * that saw it can resume.
 */
export class EventRing {
  readonly #key = randomBytes(6).toString("base64url");
  readonly #limits: RingLimits;
  #entries: RingEntry[] = [];
  #chars = 0;
  #seq = 0;
  /** The newest seq that left the ring: an id below it missed something. */
  #floor = 0;

  constructor(limits: RingLimits = ringLimits) {
    this.#limits = limits;
  }

  /** The id of the newest event (`<key>:0` before the first): where a stream stands. */
  get position(): string {
    return `${this.#key}:${this.#seq}`;
  }

  /** Numbers an event and keeps its message (`format` writes it with the id). */
  push(format: (id: string) => string, now: number): RingEntry {
    this.#seq += 1;
    const entry: RingEntry = { seq: this.#seq, message: format(this.position), at: now };
    if (entry.message.length > this.#limits.chars / 4) {
      this.#entries = [];
      this.#chars = 0;
      this.#floor = entry.seq;
      return entry;
    }
    this.#entries.push(entry);
    this.#chars += entry.message.length;
    this.#evict(now);
    return entry;
  }

  /**
   * An event the user's streams should have had and were not sent (one for a
   * stream that was not open): a stream from before it cannot resume.
   */
  skip(): void {
    this.#seq += 1;
    this.#entries = [];
    this.#chars = 0;
    this.#floor = this.#seq;
  }

  /**
   * The events after `after` (an id of this ring), oldest first — none when it
   * is the newest — or null when the ring cannot tell: an id of another ring,
   * an unknown or future position, or one from before what the ring keeps.
   */
  since(after: string, now: number): readonly RingEntry[] | null {
    const separator = after.lastIndexOf(":");
    if (separator < 0 || after.slice(0, separator) !== this.#key) return null;
    const digits = after.slice(separator + 1);
    if (!/^(0|[1-9][0-9]{0,15})$/.test(digits)) return null;
    const seq = Number(digits);
    if (seq > this.#seq) return null;
    this.#evict(now);
    if (seq < this.#floor) return null;
    return this.#entries.filter((entry) => entry.seq > seq);
  }

  /** Characters kept (the ring's memory, roughly bytes). */
  get size(): number {
    return this.#chars;
  }

  #evict(now: number): void {
    const oldest = now - this.#limits.ageMs;
    let drop = 0;
    let chars = this.#chars;
    while (drop < this.#entries.length) {
      const entry = this.#entries[drop];
      if (entry === undefined) break;
      const over =
        this.#entries.length - drop > this.#limits.events ||
        chars > this.#limits.chars ||
        entry.at < oldest;
      if (!over) break;
      chars -= entry.message.length;
      this.#floor = entry.seq;
      drop += 1;
    }
    if (drop > 0) {
      this.#entries = this.#entries.slice(drop);
      this.#chars = chars;
    }
  }
}
