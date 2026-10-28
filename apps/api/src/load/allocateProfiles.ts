import { type FleetMix, type FleetProfileName, fleetMixes, fleetProfiles } from "./fleetProfiles";

/**
 * The profile of each of `people` phones, in the order they are created: the
 * mix's shares rounded by the largest remainder, so a thousand phones are the
 * mix exactly. From ten phones on every profile gets at least one (taken from
 * the largest shares), so a small fleet still speaks every protocol and app:
 * ten phones are one of each. The profiles are interleaved, each spread evenly
 * over the fleet, so that its first people — those the harness gives a browser
 * — are a fair sample too.
 */
export function allocateProfiles(people: number, mix: FleetMix): FleetProfileName[] {
  if (!Number.isInteger(people) || people < 1) throw new RangeError("people must be 1 or more");
  const shares = fleetMixes[mix];
  const total = fleetProfiles.reduce((sum, profile) => sum + shares[profile.name], 0);
  const counts = fleetProfiles.map((profile, order) => {
    const exact = (people * shares[profile.name]) / total;
    return { name: profile.name, order, count: Math.floor(exact), remainder: exact % 1 };
  });
  let left = people - counts.reduce((sum, entry) => sum + entry.count, 0);
  const byRemainder = [...counts].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const entry of byRemainder) {
    if (left === 0) break;
    entry.count += 1;
    left -= 1;
  }
  if (people >= fleetProfiles.length) {
    for (const entry of counts) {
      if (entry.count > 0) continue;
      const largest = counts.reduce((best, other) => (other.count > best.count ? other : best));
      largest.count -= 1;
      entry.count = 1;
    }
  }
  return counts
    .flatMap((entry) =>
      Array.from({ length: entry.count }, (_, index) => ({
        name: entry.name,
        order: entry.order,
        position: (index + 0.5) / entry.count,
      })),
    )
    .sort((a, b) => a.position - b.position || a.order - b.order)
    .map((slot) => slot.name);
}
