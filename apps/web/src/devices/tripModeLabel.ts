/** Overland's trip modes (walk, bicycle, car, train, …) as words for a sentence. */
export function tripModeLabel(mode: string): string {
  const names: Readonly<Record<string, string>> = {
    walk: "walk",
    run: "run",
    bicycle: "bike ride",
    car: "drive",
    taxi: "taxi ride",
    bus: "bus ride",
    train: "train ride",
    plane: "flight",
    boat: "boat trip",
    tram: "tram ride",
    metro: "metro ride",
    scooter: "scooter ride",
    motorcycle: "motorcycle ride",
  };
  return names[mode] ?? mode.replaceAll("_", " ");
}
