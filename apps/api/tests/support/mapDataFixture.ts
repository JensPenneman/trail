import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

/** The Monaco map data artefact of the workflow (tests/fixtures/mapdata/monaco/README.md). */
export const monacoDir = fileURLToPath(new URL("../fixtures/mapdata/monaco", import.meta.url));

/** The lines of one of the fixture's gzip files. */
export const fixtureLines = (name: "ways.opl.gz" | "pois.geojsonseq.gz"): string[] =>
  gunzipSync(readFileSync(`${monacoDir}/${name}`))
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0);

interface FixtureManifest {
  region: string;
  extract: { timestamp: string };
  counts: {
    ways: number;
    wayNodeRefs: number;
    pois: { features: number; kinds: Record<string, number> };
  };
}

/** The counts the fixture's manifest.json gives (the manifest is rebuilt with the workflow). */
export const monacoManifest = (): FixtureManifest =>
  JSON.parse(readFileSync(`${monacoDir}/manifest.json`, "utf8")) as FixtureManifest;

/** Avenue des Papalins: a residential one-way street of five nodes, as ways.opl.gz has it. */
export const papalins = {
  id: 4224972,
  kind: "residential",
  name: "Avenue des Papalins",
  nodes: [25177418, 4939779378, 4939779381, 4939779386, 25177397],
  geometry: [
    [7.4174924, 43.7296303],
    [7.4174638, 43.7296727],
    [7.4174191, 43.7297138],
    [7.4173286, 43.7297725],
    [7.4172044, 43.7298528],
  ],
} as const;

/** The cruise terminal, Monaco's ferry terminal, a node of pois.geojsonseq.gz. */
export const cruiseTerminal = {
  id: "n1327941175",
  kind: "ferry_terminal",
  lat: 43.7353294,
  lon: 7.4306094,
  name: "Terminal Croisiere",
} as const;
