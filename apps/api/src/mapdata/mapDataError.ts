/**
 * Map data Trail refuses to import: a file that is missing, damaged, over a
 * limit or not what its manifest says. The message names files, counts and
 * ids, never a position, so it fits the log and the terminal.
 */
export class MapDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapDataError";
  }
}
