import { readFileSync } from "node:fs";

interface FixtureFeature {
  type: string;
  geometry?: { type: string; coordinates: number[] };
  properties: Record<string, unknown>;
}

export interface OverlandFixture {
  locations: FixtureFeature[];
  current: FixtureFeature;
  trip: Record<string, unknown>;
}

/** A fresh copy of tests/fixtures/overland-batch.json (tests may modify it). */
export function overlandFixture(): OverlandFixture {
  return JSON.parse(
    readFileSync(new URL("../fixtures/overland-batch.json", import.meta.url), "utf8"),
  ) as OverlandFixture;
}
