import { type TransportMode, transportModes } from "@trail/contracts/transport";
import type { ModeVerdict, MoveFeatures } from "./pipelineTypes";
import type { ProcessingConfig, ScoringThresholds } from "./processingConfig";

/** 0 at or below `from`, 1 at or above `to`, linear between. */
const rise = (value: number, [from, to]: readonly [number, number]): number =>
  value <= from ? 0 : value >= to ? 1 : (value - from) / (to - from);

/** 1 inside [b, c], falling to 0 at a and d. */
const band = (value: number, [a, b, c, d]: readonly [number, number, number, number]): number =>
  Math.min(rise(value, [a, b]), 1 - rise(value, [c, d]));

const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * The score of every mode for a move (docs/architecture.md §17.3, inferred,
 * step 3): transparent rules over the features with the named thresholds of
 * `ScoringThresholds`. Each rule adds evidence for its mode; the strongest
 * wins, with the confidence winner / sum of all scores. Below `unknownBelow`
 * the verdict is `unknown`. Map-based evidence is 0 when the move has no map
 * data, so such moves rest on speed and CoreMotion until the map arrives.
 */
export function scoreModes(features: MoveFeatures, config: ProcessingConfig): ModeVerdict {
  const rules: ScoringThresholds = config.scoring;
  const v = features.speed.p85;
  const { ways, near, corridor, motion, dwells, ends, passed } = features;
  const moving = motion.coverage > 0;
  // Without any CoreMotion reading, "automotive" is neither for nor against.
  const automotive = moving ? motion.automotive : 0.5;

  const roadShare = (ways?.road ?? 0) + (ways?.motorway ?? 0);
  const rail = Math.max(ways?.rail ?? 0, corridor?.rail ?? 0);
  const railEvidence = rise(rail, rules.railShare);
  const roadOverlap = Math.max(corridor?.motorway ?? 0, roadShare);
  const stationEvidence = rise((dwells?.station ?? 0) + (ends?.station ?? 0), rules.stationStops);
  // Buses and trams pause at most of the stops they pass; a car only at some, by chance.
  const busStopEvidence =
    rise((dwells?.busStop ?? 0) + 0.5 * (ends?.busStop ?? 0), rules.busStops) *
    rise((dwells?.busStop ?? 0) / Math.max(1, passed?.busStop ?? 0), rules.stopRatio);
  const tramShare = Math.max(near?.tram ?? 0, ways?.tram ?? 0);
  const tramStopEvidence =
    rise((dwells?.tramStop ?? 0) + 0.5 * (ends?.tramStop ?? 0), rules.tramStops) *
    rise((dwells?.tramStop ?? 0) / Math.max(1, passed?.tramStop ?? 0), rules.stopRatio);
  const subwayShare = ways?.subway ?? 0;
  const subwayEnds = (ends?.subway ?? 0) / 2;
  const cyclewayShare = Math.max(near?.cycleway ?? 0, ways?.cycleway ?? 0);
  const footShare = Math.max(near?.foot ?? 0, ways?.foot ?? 0);
  // A car needs roads: on the map, most of the way on them (or off any way, as in a car park).
  const onRoad = ways === null ? 1 : 0.25 + 0.75 * rise(roadShare + 0.5 * ways.none, rules.onRoad);
  const altitude = features.altitude.maxM ?? 0;
  const climb = features.altitude.climbMs ?? 0;

  const walkFit = band(v, rules.walkKmh);
  const runFit = band(v, rules.runKmh);
  const cycleFit = band(v, rules.cycleKmh);
  const busFit = band(v, rules.busKmh);
  const tramFit = band(v, rules.tramKmh);

  const scores: Record<TransportMode, number> = {
    stationary:
      2.5 * (1 - rise(v, rules.stillKmh)) * (1 - rise(features.extentM, rules.stillExtentM)) +
      motion.stationary * (1 - rise(v, [rules.stillKmh[1], 2 * rules.stillKmh[1]])),
    walking:
      1.6 * walkFit + 1.8 * motion.walking * (1 - rise(v, [9, 14])) + 0.4 * footShare * walkFit,
    running: 0.9 * runFit + 2.2 * motion.running * (1 - rise(v, [18, 25])),
    cycling:
      (2.2 * motion.cycling * (1 - rise(v, [40, 50])) +
        0.8 * cycleFit +
        1.4 * cycleFit * cyclewayShare) *
      (1 - 0.8 * (moving ? motion.automotive : 0)),
    car:
      (1.0 * rise(v, rules.carKmh) +
        1.3 * (moving ? motion.automotive : 0) +
        0.8 * roadShare * rise(v, [10, 25]) +
        0.8 * (ways?.motorway ?? 0)) *
      onRoad *
      (1 - 0.7 * busStopEvidence) *
      (1 - 0.5 * tramStopEvidence * rise(tramShare, rules.tramShare)) *
      (1 - 0.7 * railEvidence * (1 - rise(roadShare, [0.3, 0.7]))) *
      (1 - rise(v, rules.carTooFastKmh)),
    bus:
      busFit *
      (2.6 * busStopEvidence + 0.3 * roadShare) *
      (0.6 + 0.4 * automotive) *
      (1 - railEvidence),
    tram: tramFit * rise(tramShare, rules.tramShare) * (1.2 + 1.6 * tramStopEvidence),
    metro:
      2.6 * rise(subwayShare, rules.subwayShare) * rise(v, [10, 20]) +
      1.5 * subwayEnds * rise(v, [10, 25]) * (1 - rise(roadShare, [0.3, 0.6])),
    train:
      // Without map data a fast move may well be a train: not certain enough to call it a car.
      (ways === null ? 1.2 * rise(v, [60, 100]) : 0) +
      3.2 *
        railEvidence *
        rise(v, rules.trainKmh) *
        Math.max(0.35, stationEvidence, 1 - rise(roadOverlap, [0.3, 0.7])) +
      0.6 * stationEvidence * rise(rail, [0.2, 0.5]),
    boat: 2.8 * rise(ways?.ferry ?? 0, rules.ferryShare) * band(v, rules.boatKmh),
    plane:
      3.2 * rise(v, rules.planeKmh) +
      2 * rise(altitude, rules.planeAltitudeM) +
      1.5 * rise(climb, rules.planeClimbMs),
    unknown: 0,
  };
  if (features.tripMode !== null) scores[features.tripMode] += rules.tripBonus;

  let winner: TransportMode = "unknown";
  let best = 0;
  let total = 0;
  for (const mode of transportModes) {
    const score = Math.max(0, scores[mode]);
    scores[mode] = round(score);
    total += score;
    if (score > best) {
      best = score;
      winner = mode;
    }
  }
  const confidence = total > 0 ? round(best / total) : 0;
  return {
    mode: confidence < config.review.unknownBelow ? "unknown" : winner,
    confidence,
    scores,
  };
}
