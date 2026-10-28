let generation = 0;

/**
 * How many times this process committed rebuilt heat cells that no device's
 * point counter shows — the start-up fill of missing levels
 * (`fillHeatLevels`); uploads and deletions move the counters themselves. The
 * heatmap's ETag hashes it with the counters (docs/architecture.md §8.9).
 */
export const heatGeneration = (): number => generation;

/** Called once a fill's transaction has committed: answers built before it are stale now. */
export function heatCellsRebuilt(): void {
  generation += 1;
}
