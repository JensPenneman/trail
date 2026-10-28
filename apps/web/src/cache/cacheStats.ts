/**
 * What the copy did during this page load, for Settings › About › On this
 * device. It never leaves the device.
 */
export interface CacheCounters {
  /** Entries restored from the store, and their bytes. */
  restored: number;
  restoredBytes: number;
  /** How long the warm set took to read before the first paint; null until it was read. */
  warmMs: number | null;
  /** Answers shown from the copy: restored, or a past day whose stamps still matched. */
  hits: number;
  /** Queries the copy had nothing for. */
  misses: number;
  /** Requests sent with the copy's ETag, and those the server answered `304 Not Modified`. */
  revalidations: number;
  notModified: number;
  /** Entries dropped when read: another format, owner or zone, damaged, or refused by the contract. */
  invalid: number;
  /** Sweeps run, and the entries they removed. */
  sweeps: number;
  swept: number;
  /** Answers not written: too large, past the hard budget, or refused by the browser. */
  refused: number;
  /** The browser ran out of room twice: nothing more is written during this page load. */
  memoryOnly: boolean;
}

type Counter = Exclude<keyof CacheCounters, "warmMs" | "memoryOnly">;

const zero = (): CacheCounters => ({
  restored: 0,
  restoredBytes: 0,
  warmMs: null,
  hits: 0,
  misses: 0,
  revalidations: 0,
  notModified: 0,
  invalid: 0,
  sweeps: 0,
  swept: 0,
  refused: 0,
  memoryOnly: false,
});

export interface CacheStats {
  get(): CacheCounters;
  subscribe(listener: () => void): () => void;
  add(counter: Counter, amount?: number): void;
  warmRead(ms: number): void;
  memoryOnly(): void;
  /** A purge starts them again. */
  reset(): void;
}

export function createCacheStats(): CacheStats {
  let counters = zero();
  const listeners = new Set<() => void>();
  const update = (next: CacheCounters) => {
    counters = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => counters,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: (counter, amount = 1) => {
      if (amount !== 0) update({ ...counters, [counter]: counters[counter] + amount });
    },
    warmRead: (ms) => update({ ...counters, warmMs: ms }),
    memoryOnly: () => {
      if (!counters.memoryOnly) update({ ...counters, memoryOnly: true });
    },
    reset: () => update(zero()),
  };
}
