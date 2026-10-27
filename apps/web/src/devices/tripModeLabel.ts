/** A Map: modes come from the phone; an object would answer `constructor` from its prototype. */
const names: ReadonlyMap<string, string> = new Map([
  ["walk", "walk"],
  ["run", "run"],
  ["bicycle", "bike ride"],
  ["car", "drive"],
  ["taxi", "taxi ride"],
  ["bus", "bus ride"],
  ["train", "train ride"],
  ["plane", "flight"],
  ["boat", "boat trip"],
  ["tram", "tram ride"],
  ["metro", "metro ride"],
  ["scooter", "scooter ride"],
  ["motorcycle", "motorcycle ride"],
]);

/** Overland's trip modes (walk, bicycle, car, train, …) as words for a sentence. */
export function tripModeLabel(mode: string): string {
  return names.get(mode) ?? mode.replaceAll("_", " ");
}
