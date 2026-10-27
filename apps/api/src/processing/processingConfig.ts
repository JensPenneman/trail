/**
 * Every threshold of the processing pipeline (docs/architecture.md §17) in one
 * typed object. The stages take it as an argument, so tests can vary it, and
 * `segments.features` keeps what each move was judged on, so a change here can
 * be evaluated against stored segments (and the corrections people made)
 * before it ships. A change bumps the version of its level and of every level
 * above it (`processingVersions`): `averaging` belongs to the averaged level,
 * `stops` and `mapping` to the mapped level (stops are found before map
 * matching), the rest to the inferred level.
 */
export interface ProcessingConfig {
  readonly averaging: {
    /** Points less accurate than this are dropped (PROCESSING_MAX_ACCURACY_M). */
    readonly maxAccuracyM: number;
    /** A point that implies more than this from both neighbours (which agree with each other) is a spike. */
    readonly spikeSpeedMs: number;
    /** Runs of up to this many points can be one spike (a glitch that lasts a few fixes). */
    readonly spikeMaxRun: number;
    /** Stationary cluster: within max(accuracy, this) of the running centroid … */
    readonly clusterRadiusM: number;
    /** … at no more than this speed. */
    readonly clusterSpeedMs: number;
    /** Moving points are averaged with neighbours this close in time … */
    readonly windowS: number;
    /** … at most this many on each side … */
    readonly maxNeighbours: number;
    /** … and within this many accuracies of the point (at speed, movement outweighs noise). */
    readonly neighbourAccuracies: number;
    readonly minNeighbourRadiusM: number;
    /** Weights are 1/accuracy², with the accuracy floored here. */
    readonly minWeightAccuracyM: number;
    /** Assumed accuracy when the phone reported none. */
    readonly defaultAccuracyM: number;
  };
  readonly stops: {
    /** A stop lasts at least this long (PROCESSING_STOP_MIN_S) … */
    readonly minDurationS: number;
    /** … within this radius of its centroid. */
    readonly radiusM: number;
    /** After a recording pause this long, a point this close still belongs to the stop (iOS resumes outside its geofence). */
    readonly pauseGapS: number;
    readonly pauseRadiusM: number;
    /** Two stops this close with only a short wander between them are one stop. */
    readonly mergeRadiusM: number;
    readonly mergeMoveMaxS: number;
    /** Points of an iOS visit within this radius are part of its stop. */
    readonly visitRadiusM: number;
    /**
     * A recording gap longer than this ends a move unless the device clearly travelled meanwhile …
     * (and one whose two ends lie within `pauseRadiusM` of each other is a stop: the phone lay still)
     */
    readonly gapSplitS: number;
    /** … at this speed or faster (a flight, a train through tunnels). */
    readonly gapKeepSpeedMs: number;
    /** Two stays with a real walk between them are not one stay: this long … */
    readonly walkMinS: number;
    /** … faster than this (or CoreMotion on foot throughout): the walk from the bike shed to the platform. */
    readonly walkSpeedMs: number;
    /** A stop never holds travel: this long or longer farther than `pauseRadiusM` from its centroid. */
    readonly travelMinS: number;
  };
  readonly mapping: {
    readonly tileZoom: number;
    /** Candidate radius: clamp(factor × accuracy, min, max). */
    readonly radiusFactor: number;
    readonly minRadiusM: number;
    readonly maxRadiusM: number;
    /** Emission sigma: max(accuracy, this). */
    readonly minSigmaM: number;
    readonly maxCandidates: number;
    /** Only points this far apart enter the HMM; the ones between are projected onto its path. */
    readonly matchSpacingM: number;
    /** Route search bound: min(maxRouteM, chord × routeFactor + routeSlackM) and at most maxHops way changes. */
    readonly maxRouteM: number;
    readonly routeFactor: number;
    readonly routeSlackM: number;
    readonly maxHops: number;
    /** Transition cost |route − chord| / β with β = max(betaMinM, betaChordFactor × chord). */
    readonly betaMinM: number;
    readonly betaChordFactor: number;
    /** Extra cost of moving onto another way of the same kind of network. */
    readonly wayChangeCost: number;
    /** Cost of a transition without a route: another network (rail ↔ road) or out of reach. */
    readonly jumpCost: number;
    /** Emission cost of leaving the network (a park, a square, the sea). */
    readonly offRoadCost: number;
    readonly offRoadTransitionCost: number;
    /** Map data around the straight line between distant points: min(max, factor × chord) on each side … */
    readonly corridorFactor: number;
    readonly corridorMaxM: number;
    /** … unless covering it takes more than this speed (high-speed trains stay below 90 m/s). A move that typically goes faster is a flight: no map data at all. */
    readonly groundMaxSpeedMs: number;
    /** A window's map data is loaded a piece at a time: moves together up to this many tiles, a longer move in stretches of about this many … */
    readonly pieceMaxTiles: number;
    /** … each matched with this much of the move beyond its ends, so the seams match as the whole move would. */
    readonly seamMarginM: number;
    /** A cached tile older than this keeps serving and is fetched again when a window needs it (PROCESSING_OSM_TTL_DAYS). */
    readonly tileMaxAgeDays: number;
  };
  readonly features: {
    /** Interval speeds from pairs at most this far apart; sparser pairs use the distance along the track. */
    readonly pairMaxGapS: number;
    /** Intervals up to this long take the points' own speeds; longer ones distance over time. */
    readonly denseIntervalS: number;
    readonly corridorStepM: number;
    readonly corridorRadiusM: number;
    /** A point counts as near a way within max(this, 1.5 × accuracy), at most nearMaxM. */
    readonly nearMinM: number;
    readonly nearMaxM: number;
    /** A pause inside a move: at most this speed for at least this long. */
    readonly dwellSpeedMs: number;
    readonly dwellMinS: number;
    /** How close a pause or a stop must be to a stop of each kind. */
    readonly poiRadiusM: {
      readonly station: number;
      readonly tramStop: number;
      readonly subway: number;
      readonly busStop: number;
      readonly ferry: number;
      readonly aerodrome: number;
    };
    /** A bus or tram stop counts as passed within this distance of a point. */
    readonly passRadiusM: number;
    /** An Overland trip counts when it covers this share of the move. */
    readonly tripOverlapShare: number;
    /** Altitude readings with a worse vertical accuracy are ignored. */
    readonly maxVerticalAccuracyM: number;
    readonly climbMinIntervalS: number;
  };
  readonly scoring: ScoringThresholds;
  readonly splitting: {
    /** The sliding window, its step, and how long or far a change of winner must last. */
    readonly windowS: number;
    readonly strideS: number;
    readonly minRunS: number;
    readonly minRunM: number;
    /** Windows slower than this (km/h p85) are pauses: they never decide a change. */
    readonly pauseKmh: number;
  };
  readonly overrides: {
    /** A move's leftover beside an override shorter than this joins the override (segments shift a little when recomputed); an override that covers less of a move than this, and not most of it, leaves it alone. */
    readonly sliverS: number;
  };
  readonly review: {
    /** Below this confidence a move is `unknown` … */
    readonly unknownBelow: number;
    /** … and below this one it is flagged for review. */
    readonly reviewBelow: number;
  };
}

/** The named thresholds of the mode rules (km/h, shares 0–1, counts). */
export interface ScoringThresholds {
  readonly walkKmh: readonly [number, number, number, number];
  readonly runKmh: readonly [number, number, number, number];
  readonly cycleKmh: readonly [number, number, number, number];
  readonly carKmh: readonly [number, number];
  readonly carTooFastKmh: readonly [number, number];
  readonly busKmh: readonly [number, number, number, number];
  readonly tramKmh: readonly [number, number, number, number];
  readonly trainKmh: readonly [number, number];
  readonly boatKmh: readonly [number, number, number, number];
  readonly planeKmh: readonly [number, number];
  readonly planeAltitudeM: readonly [number, number];
  readonly planeClimbMs: readonly [number, number];
  readonly stillKmh: readonly [number, number];
  readonly stillExtentM: readonly [number, number];
  /** Rail evidence (matched share or corridor ratio) from … to … */
  readonly railShare: readonly [number, number];
  readonly tramShare: readonly [number, number];
  readonly subwayShare: readonly [number, number];
  readonly ferryShare: readonly [number, number];
  /** Pauses at stops: from … to … for full evidence. */
  readonly stationStops: readonly [number, number];
  readonly busStops: readonly [number, number];
  readonly tramStops: readonly [number, number];
  /** Share of the passed stops the move paused at: buses and trams stop at most of them. */
  readonly stopRatio: readonly [number, number];
  /** On roads (or off the map) from … to …: below it a car is unlikely. */
  readonly onRoad: readonly [number, number];
  /** Bonus for the mode of an Overland trip. */
  readonly tripBonus: number;
}

export const defaultProcessingConfig: ProcessingConfig = {
  averaging: {
    maxAccuracyM: 150,
    spikeSpeedMs: 90,
    spikeMaxRun: 3,
    clusterRadiusM: 25,
    clusterSpeedMs: 0.5,
    windowS: 20,
    maxNeighbours: 3,
    neighbourAccuracies: 2,
    minNeighbourRadiusM: 10,
    minWeightAccuracyM: 5,
    defaultAccuracyM: 30,
  },
  stops: {
    minDurationS: 180,
    radiusM: 60,
    pauseGapS: 300,
    pauseRadiusM: 300,
    mergeRadiusM: 80,
    mergeMoveMaxS: 300,
    visitRadiusM: 150,
    gapSplitS: 1800,
    gapKeepSpeedMs: 10,
    walkMinS: 30,
    walkSpeedMs: 0.6,
    travelMinS: 120,
  },
  mapping: {
    tileZoom: 14,
    radiusFactor: 1.5,
    minRadiusM: 25,
    maxRadiusM: 120,
    minSigmaM: 10,
    maxCandidates: 4,
    matchSpacingM: 30,
    maxRouteM: 25_000,
    routeFactor: 2,
    routeSlackM: 300,
    maxHops: 40,
    betaMinM: 25,
    betaChordFactor: 0.15,
    wayChangeCost: 0.3,
    jumpCost: 8,
    offRoadCost: 2.5,
    offRoadTransitionCost: 1,
    corridorFactor: 0.1,
    corridorMaxM: 1000,
    groundMaxSpeedMs: 100,
    pieceMaxTiles: 256,
    seamMarginM: 1500,
    tileMaxAgeDays: 90,
  },
  features: {
    pairMaxGapS: 600,
    denseIntervalS: 30,
    corridorStepM: 250,
    corridorRadiusM: 200,
    nearMinM: 20,
    nearMaxM: 50,
    dwellSpeedMs: 1,
    dwellMinS: 15,
    poiRadiusM: {
      station: 300,
      tramStop: 60,
      subway: 250,
      busStop: 40,
      ferry: 300,
      aerodrome: 3000,
    },
    passRadiusM: 25,
    tripOverlapShare: 0.5,
    maxVerticalAccuracyM: 50,
    climbMinIntervalS: 20,
  },
  scoring: {
    walkKmh: [0.5, 2, 7, 10],
    runKmh: [6, 8.5, 16, 20],
    cycleKmh: [8, 11, 30, 38],
    carKmh: [15, 35],
    carTooFastKmh: [170, 220],
    busKmh: [12, 18, 55, 70],
    tramKmh: [8, 12, 60, 80],
    trainKmh: [40, 70],
    boatKmh: [3, 6, 60, 80],
    planeKmh: [200, 280],
    planeAltitudeM: [1500, 3000],
    planeClimbMs: [4, 8],
    stillKmh: [1.5, 3],
    stillExtentM: [80, 200],
    railShare: [0.4, 0.7],
    tramShare: [0.4, 0.75],
    subwayShare: [0.25, 0.6],
    ferryShare: [0.3, 0.6],
    stationStops: [0.5, 2],
    busStops: [0.5, 2.5],
    tramStops: [0.5, 2],
    stopRatio: [0.25, 0.6],
    onRoad: [0.2, 0.6],
    tripBonus: 2.5,
  },
  splitting: {
    windowS: 180,
    strideS: 30,
    minRunS: 120,
    minRunM: 500,
    pauseKmh: 3,
  },
  overrides: {
    sliverS: 90,
  },
  review: {
    unknownBelow: 0.4,
    reviewBelow: 0.6,
  },
};

/** The defaults with what the environment can change (docs/architecture.md §4). */
export function processingConfigWith(settings: {
  maxAccuracyM: number;
  stopMinS: number;
  osmTtlDays: number;
}): ProcessingConfig {
  return {
    ...defaultProcessingConfig,
    averaging: { ...defaultProcessingConfig.averaging, maxAccuracyM: settings.maxAccuracyM },
    stops: { ...defaultProcessingConfig.stops, minDurationS: settings.stopMinS },
    mapping: { ...defaultProcessingConfig.mapping, tileMaxAgeDays: settings.osmTtlDays },
  };
}
