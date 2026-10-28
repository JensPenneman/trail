/** Accepted uploads since the last `take`: what the load line reports per minute. */
export interface IngestTally {
  uploads: number;
  points: number;
  duplicates: number;
  rejected: number;
}

/**
 * Counts the accepted uploads of every ingest endpoint for the load line
 * (docs/perf/README.md). Numbers only: nothing of a device or its points.
 */
export class IngestMeter {
  #tally: IngestTally = { uploads: 0, points: 0, duplicates: 0, rejected: 0 };

  record(counts: { locations: number; duplicates: number; rejected: number }): void {
    this.#tally.uploads += 1;
    this.#tally.points += counts.locations;
    this.#tally.duplicates += counts.duplicates;
    this.#tally.rejected += counts.rejected;
  }

  /** The counts since the last call, which start again from zero. */
  take(): IngestTally {
    const tally = this.#tally;
    this.#tally = { uploads: 0, points: 0, duplicates: 0, rejected: 0 };
    return tally;
  }
}
