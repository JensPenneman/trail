/**
 * What the camera frames: a period and the devices drawn. Views showing the
 * same (Live, and History on today) share it, so switching between them keeps
 * the camera; another day or other devices frame anew.
 */
export function fitKey(from: string, to: string, deviceIds: readonly string[]): string {
  return `${from}..${to}|${[...deviceIds].sort().join(",")}`;
}
