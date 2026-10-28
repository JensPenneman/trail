import { describe, expect, it } from "vitest";
import type { OverrideSpan } from "../../src/processing/pipelineTypes";
import { morning, motorwayDrive } from "../support/journeys";
import { moves, processWorld } from "../support/processWorld";
import {
  concat,
  lastT,
  motorwayLine,
  pointAlong,
  stay,
  subPath,
  travel,
  type Vertex,
} from "../support/syntheticWorld";

const override = (
  fields: Partial<OverrideSpan> & Pick<OverrideSpan, "from" | "mode">,
): OverrideSpan => ({
  id: `o-${fields.from}-${fields.mode}`,
  kind: "segment",
  to: null,
  endsBy: null,
  stoppedBefore: false,
  createdAt: 0,
  source: "ui",
  ...fields,
});

/** Two drives on the motorway with a stop between them, ten minutes long unless asked. */
function twoDrives(stopS = 600) {
  const first = travel(subPath(motorwayLine, 500, 12_500), {
    startT: morning,
    speedMs: 30,
    intervalS: 1,
    motion: ["driving"],
    seed: 3,
  });
  const pause = stay(motorwayLine[26] ?? [12_500, -3000], {
    startT: lastT(first) + 1,
    durationS: stopS,
    intervalS: 5,
    seed: 4,
  });
  const second = travel(subPath(motorwayLine, 12_500, 24_500), {
    startT: lastT(pause) + 1,
    speedMs: 30,
    intervalS: 1,
    motion: ["driving"],
    seed: 5,
  });
  return concat(first, pause, second);
}

describe("applyOverrides", () => {
  it("lets a segment override win over the inference, also after recomputation", () => {
    const points = motorwayDrive();
    const [drive] = moves(processWorld(points));
    expect(drive?.modeInferred).toBe("car");
    const correction = override({ from: drive?.startT ?? 0, to: drive?.endT ?? 0, mode: "bus" });
    const once = moves(processWorld(points, { overrides: [correction] }));
    expect(once.map((move) => [move.modeUser, move.modeInferred])).toEqual([["bus", "car"]]);
    expect(once[0]?.features["override"]).toEqual({
      id: correction.id,
      kind: "segment",
      source: "ui",
    });
    // Recomputing (new data, a new version) keeps the correction.
    const again = moves(processWorld(points, { overrides: [correction] }));
    expect(again).toEqual(once);
  });

  it("still fits when the segment moved by a few seconds", () => {
    const points = motorwayDrive();
    const [drive] = moves(processWorld(points));
    const shifted = override({
      from: (drive?.startT ?? 0) + 20,
      to: (drive?.endT ?? 0) - 15,
      mode: "bus",
    });
    const result = moves(processWorld(points, { overrides: [shifted] }));
    expect(result).toHaveLength(1);
    expect(result[0]?.modeUser).toBe("bus");
  });

  it("cuts a move to fit an override inside it", () => {
    const points = motorwayDrive();
    const middle = override({ from: morning + 300, to: morning + 600, mode: "train" });
    const result = moves(processWorld(points, { overrides: [middle] }));
    expect(result.map((move) => move.modeUser)).toEqual([null, "train", null]);
    expect(result.map((move) => move.modeInferred)).toEqual(["car", "car", "car"]);
    expect(result[1]?.startT).toBe(morning + 300);
    expect(result[1]?.endT).toBe(morning + 600);
  });

  it("leaves a move alone that an override only grazes", () => {
    const points = motorwayDrive();
    const graze = override({ from: lastT(points) - 20, to: lastT(points) + 3600, mode: "train" });
    expect(
      moves(processWorld(points, { overrides: [graze] })).map((move) => move.modeUser),
    ).toEqual([null]);
  });

  it("applies overrides in the order they were made", () => {
    const points = motorwayDrive();
    const older = override({
      id: "a",
      from: morning,
      to: lastT(points),
      mode: "bus",
      createdAt: 1,
    });
    const newer = override({
      id: "b",
      from: morning,
      to: lastT(points),
      mode: "train",
      createdAt: 2,
    });
    expect(moves(processWorld(points, { overrides: [newer, older] }))[0]?.modeUser).toBe("train");
  });

  it("ends the quick toggle at the first stop of ten minutes or more", () => {
    const toggle = override({ kind: "toggle", from: morning + 60, mode: "train" });
    const [first, second] = moves(processWorld(twoDrives(900), { overrides: [toggle] }));
    expect(first?.modeUser).toBe("train");
    expect(second?.modeUser).toBeNull();
    expect(second?.modeInferred).toBe("car");
    // A change of trains, five minutes on the platform, does not end it.
    const changed = moves(processWorld(twoDrives(300), { overrides: [toggle] }));
    expect(changed.map((move) => move.modeUser)).toEqual(["train", "train"]);
  });

  it("ends the quick toggle at a move of another kind of travel, after a short stop too", () => {
    // Off the train (driven here on the motorway), five minutes on the platform, then 3 km by bike.
    const ride = travel(subPath(motorwayLine, 500, 12_500), {
      startT: morning,
      speedMs: 30,
      intervalS: 1,
      motion: ["driving"],
      seed: 3,
    });
    const station = pointAlong(motorwayLine, 12_500);
    const platform = stay(station, {
      startT: lastT(ride) + 1,
      durationS: 300,
      intervalS: 5,
      seed: 4,
    });
    const home = travel([station, [station[0], station[1] + 3000]], {
      startT: lastT(platform) + 1,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 8,
    });
    const train = override({ kind: "toggle", from: morning + 60, mode: "train" });
    const off = moves(processWorld(concat(ride, platform, home), { overrides: [train] }));
    expect(off.map((move) => [move.modeUser, move.modeInferred])).toEqual([
      ["train", "car"],
      [null, "cycling"],
    ]);

    // A bike set at home: the ride to the station, eight minutes there, then 13 km at 30 m/s.
    const start = pointAlong(motorwayLine, 500);
    const house: Vertex = [start[0], start[1] - 2000];
    const atHome = stay(house, { startT: morning, durationS: 600, intervalS: 10, seed: 2 });
    const toStation = travel([house, start], {
      startT: lastT(atHome) + 1,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 9,
    });
    const waiting = stay(start, {
      startT: lastT(toStation) + 1,
      durationS: 480,
      intervalS: 5,
      seed: 4,
    });
    const onward = travel(subPath(motorwayLine, 500, 13_500), {
      startT: lastT(waiting) + 1,
      speedMs: 30,
      intervalS: 1,
      motion: ["driving"],
      seed: 5,
    });
    const bike = override({ kind: "toggle", from: morning + 300, mode: "cycling" });
    const on = moves(
      processWorld(concat(atHome, toStation, waiting, onward), { overrides: [bike] }),
    );
    expect(on.map((move) => [move.modeUser, move.modeInferred])).toEqual([
      ["cycling", "cycling"],
      [null, "car"],
    ]);
  });

  it("gives the quick toggle the first move it reaches, all of it, whatever the inference reads", () => {
    const user = (
      points: Parameters<typeof processWorld>[0],
      from: number,
      mode: "cycling" | "train",
    ) =>
      moves(processWorld(points, { overrides: [override({ kind: "toggle", from, mode })] })).map(
        (move) => [move.modeUser, move.modeInferred],
      );
    // A bike ride whose middle stretch reads as a car: set at the shed, or a minute after setting off.
    const shed = pointAlong(motorwayLine, 500);
    const atShed = stay(shed, { startT: morning, durationS: 300, intervalS: 5, seed: 2 });
    const out = travel(subPath(motorwayLine, 500, 3500), {
      startT: lastT(atShed) + 1,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 3,
    });
    const fast = travel(subPath(motorwayLine, 3500, 7700), {
      startT: lastT(out) + 2,
      speedMs: 14,
      intervalS: 2,
      motion: [],
      seed: 4,
    });
    const on = travel(subPath(motorwayLine, 7700, 10_700), {
      startT: lastT(fast) + 2,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 5,
    });
    const ride = concat(atShed, out, fast, on);
    const corrected = [
      ["cycling", "cycling"],
      ["cycling", "car"],
      ["cycling", "cycling"],
    ];
    expect(user(ride, morning + 240, "cycling")).toEqual(corrected);
    expect(user(ride, lastT(atShed) + 60, "cycling")).toEqual(corrected);
    // A ride read as a car all the way.
    const car = travel(subPath(motorwayLine, 500, 8900), {
      startT: lastT(atShed) + 1,
      speedMs: 14,
      intervalS: 2,
      motion: [],
      seed: 9,
    });
    expect(user(concat(atShed, car), morning + 240, "cycling")).toEqual([["cycling", "car"]]);
    // A train set at the station's entrance: three minutes to the platform, four there, the train.
    const platform: Vertex = [shed[0], shed[1] - 250];
    const walk = travel([shed, platform], {
      startT: lastT(atShed) + 1,
      speedMs: 1.4,
      intervalS: 2,
      motion: ["walking"],
      seed: 6,
    });
    const waiting = stay(platform, {
      startT: lastT(walk) + 1,
      durationS: 240,
      intervalS: 5,
      seed: 7,
    });
    const train = travel([platform, ...subPath(motorwayLine, 600, 13_500)], {
      startT: lastT(waiting) + 1,
      speedMs: 30,
      intervalS: 1,
      motion: ["driving"],
      seed: 8,
    });
    expect(user(concat(atShed, walk, waiting, train), morning + 280, "train")).toEqual([
      ["train", "walking"],
      ["train", "car"],
    ]);
  });

  it("knows across windows whether a stop came since the toggle began", () => {
    // A window that starts at the ride home: the train toggle began before it.
    const start = pointAlong(motorwayLine, 500);
    const ride = travel([start, [start[0], start[1] + 3000]], {
      startT: morning,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 8,
    });
    const train = (stoppedBefore: boolean) =>
      moves(
        processWorld(ride, {
          overrides: [
            override({ kind: "toggle", from: morning - 1800, mode: "train", stoppedBefore }),
          ],
        }),
      ).map((move) => [move.modeUser, move.modeInferred]);
    // After five minutes at the station (a stop the window does not hold): the bike ends it.
    expect(train(true)).toEqual([[null, "cycling"]]);
    // Still on the ride it was set on (no stop since): the toggle's own move, whatever it reads.
    expect(train(false)).toEqual([["train", "cycling"]]);
  });

  it("ends the quick toggle at its until, or at a stop seen before this window", () => {
    const points = twoDrives();
    const until = override({
      kind: "toggle",
      from: morning + 120,
      to: morning + 300,
      mode: "train",
    });
    const parts = moves(processWorld(points, { overrides: [until] }));
    expect(parts.map((move) => move.modeUser)).toEqual([null, "train", null, null]);
    expect([parts[1]?.startT, parts[1]?.endT]).toEqual([morning + 120, morning + 300]);
    const known = override({
      kind: "toggle",
      from: morning - 3600,
      endsBy: morning - 600,
      mode: "train",
    });
    expect(
      moves(processWorld(points, { overrides: [known] })).map((move) => move.modeUser),
    ).toEqual([null, null]);
  });

  it("never gives a stop a mode", () => {
    const points = twoDrives();
    const everything = override({ from: morning - 60, to: lastT(points) + 60, mode: "bus" });
    const result = processWorld(points, { overrides: [everything] });
    for (const segment of result.segments) {
      expect(segment.modeUser).toBe(segment.kind === "stop" ? null : "bus");
    }
  });
});
