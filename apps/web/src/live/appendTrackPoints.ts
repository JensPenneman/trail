import type { Track, TrackPoint, TracksResponse } from "@trail/contracts/track";

/**
 * Adds freshly uploaded points to a cached tracks response when they fall in
 * its `[from, to)` range and pass the same accuracy filter the server applies.
 * Points are keyed by their second (the server stores at most one per second),
 * so a re-sent batch never duplicates anything. Returns the same object when
 * nothing changed, which lets callers skip the cache write.
 */
export function appendTrackPoints(
  response: TracksResponse,
  deviceId: string,
  points: readonly TrackPoint[],
  maxAccuracy: number,
): TracksResponse {
  const from = Date.parse(response.from) / 1000;
  const to = Date.parse(response.to) / 1000;
  const fresh = points.filter(
    (point) => point[2] >= from && point[2] < to && (point[4] === null || point[4] <= maxAccuracy),
  );
  if (fresh.length === 0) return response;

  const existing = response.tracks.find((track) => track.deviceId === deviceId);
  const byTime = new Map<number, TrackPoint>();
  for (const point of existing?.points ?? []) byTime.set(point[2], point);
  let added = 0;
  for (const point of fresh) {
    if (!byTime.has(point[2])) added += 1;
    byTime.set(point[2], point);
  }
  if (added === 0) return response;

  const merged = [...byTime.values()].sort((a, b) => a[2] - b[2]);
  const first = merged[0];
  const last = merged[merged.length - 1];
  const track: Track = {
    deviceId,
    total: (existing?.total ?? 0) + added,
    returned: merged.length,
    simplified: existing?.simplified ?? false,
    distanceM: existing?.distanceM ?? 0,
    firstAt: first === undefined ? null : new Date(first[2] * 1000).toISOString(),
    lastAt: last === undefined ? null : new Date(last[2] * 1000).toISOString(),
    points: merged,
  };
  return {
    ...response,
    tracks:
      existing === undefined
        ? [...response.tracks, track]
        : response.tracks.map((candidate) => (candidate.deviceId === deviceId ? track : candidate)),
  };
}
