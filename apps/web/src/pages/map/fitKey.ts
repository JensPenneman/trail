/**
 * What the camera frames: a view's period, whose data and the devices drawn.
 * Another person, day or other devices frame anew; the same ones keep the
 * camera where the person left it.
 */
export function fitKey(scope: string, who: string | null, deviceIds: readonly string[]): string {
  return `${scope}|${who ?? "everyone"}|${[...deviceIds].sort().join(",")}`;
}
