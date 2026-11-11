/*
 * What the stay rule reads of a stop (`stayParts.ts`), in a module of its own:
 * the pipeline's types, and with them the pure rail core, depend on this shape
 * and must not reach the SQL of the rule (or the ORM it imports).
 */

export interface Position {
  lat: number;
  lon: number;
}

/** What the rule reads of a stop: its times (epoch seconds), ends and middle, and its spread. */
export interface StopShape {
  startT: number;
  endT: number;
  start: Position;
  end: Position;
  centroid: Position;
  spreadM: number | null;
}
