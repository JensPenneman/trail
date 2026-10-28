/**
 * Whether what is on screen may be called live (docs/architecture.md §14):
 * "Live" is decided from a position's own time against the clock, and on top
 * of that, while the event stream is not open, only while the newest answer
 * is itself within the live window — a copy restored from disk an hour after
 * it was fetched says "as of 10:32" instead, whatever it contains.
 */
export function liveWindowOpen(
  connection: "connecting" | "open" | "reconnecting",
  answeredAt: number,
  now: number,
  liveMinutes: number,
): boolean {
  return connection === "open" || now - answeredAt <= liveMinutes * 60_000;
}
