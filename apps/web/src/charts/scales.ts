/**
 * Maps a value domain linearly onto pixels. A collapsed domain (nothing to
 * show) maps every value to the start of the range rather than dividing by
 * zero.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (!Number.isFinite(span) || span === 0) return () => r0;
  const ratio = (r1 - r0) / span;
  return (value) => r0 + (value - d0) * ratio;
}
