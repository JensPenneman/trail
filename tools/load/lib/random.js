/*
 * Seeded numbers for the load harness: the same seed gives the same fleet, the
 * same schedule and the same points in k6 and in Node, so a run can be played
 * again. Plain JavaScript without imports, for both runtimes.
 */

/**
 * mulberry32: a small, fast generator with 32 bits of state; uniform in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seed for one named stream of numbers (FNV-1a over the parts), so that a
 * device's schedule does not change when another device is added.
 * @param {...(string | number)} parts
 * @returns {number}
 */
export function seedOf(...parts) {
  let hash = 0x811c9dc5;
  for (const char of parts.join("\u001f")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A seeded generator for one named stream.
 * @param {...(string | number)} parts
 */
export const randomFor = (...parts) => mulberry32(seedOf(...parts));

/**
 * Uniform in [low, high).
 * @param {() => number} random
 * @param {number} low
 * @param {number} high
 */
export const between = (random, low, high) => low + (high - low) * random();

/**
 * Standard normal (Box–Muller).
 * @param {() => number} random
 */
export function gaussian(random) {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One of `items` by weight.
 * @template T
 * @param {() => number} random
 * @param {readonly (readonly [T, number])[]} entries
 * @returns {T}
 */
export function weighted(random, entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let left = random() * total;
  for (const [value, weight] of entries) {
    left -= weight;
    if (left < 0) return value;
  }
  const last = entries.at(-1);
  if (last === undefined) throw new Error("weighted: no entries");
  return last[0];
}
