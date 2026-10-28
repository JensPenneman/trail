import { describe, expect, it } from "vitest";
import {
  decodeGeometry,
  encodeFixedGeometry,
  encodeGeometry,
} from "../../src/mapdata/geometryCodec";
import { worldMap } from "../support/syntheticWorld";

describe("the compact geometry", () => {
  it("writes big-endian int32 pairs of longitude and latitude in 1e-7 degrees", () => {
    const bytes = encodeGeometry([
      [7.4174924, 43.7296303],
      [-0.5, -89.9999999],
      [180, 90],
    ]);
    // What the migration's int4send conversion writes for the same positions.
    expect(bytes.toString("hex")).toBe(
      "046bd1cc1a109caf" + "ffb3b4c0ca5b1701" + "6b49d20035a4e900",
    );
    expect(
      encodeFixedGeometry(
        Int32Array.from([
          74_174_924, 437_296_303, -5_000_000, -899_999_999, 1_800_000_000, 900_000_000,
        ]),
      ),
    ).toEqual(bytes);
  });

  it("gives back coordinates of up to seven decimals exactly", () => {
    const positions: [number, number][] = [
      [7.4174924, 43.7296303],
      [3.1, 51.0000001],
      [-179.9999999, -85.0511287],
      [0, 0],
      [0.0000001, -0.0000001],
    ];
    expect(decodeGeometry(encodeGeometry(positions))).toEqual(positions);
  });

  it("rounds finer coordinates to 1e-7 degrees, about a centimetre", () => {
    for (const way of worldMap().ways) {
      const decoded = decodeGeometry(encodeGeometry(way.geometry));
      expect(decoded).toHaveLength(way.geometry.length);
      for (const [index, [lon, lat]] of decoded.entries()) {
        expect(Math.abs(lon - (way.geometry[index]?.[0] ?? 0))).toBeLessThanOrEqual(5e-8);
        expect(Math.abs(lat - (way.geometry[index]?.[1] ?? 0))).toBeLessThanOrEqual(5e-8);
      }
    }
  });

  it("reads bytes at any offset of a buffer", () => {
    const bytes = encodeGeometry([
      [7.4174924, 43.7296303],
      [7.4174638, 43.7296727],
    ]);
    const padded = Buffer.concat([Buffer.from([1, 2, 3]), bytes]).subarray(3);
    expect(decodeGeometry(padded)).toEqual([
      [7.4174924, 43.7296303],
      [7.4174638, 43.7296727],
    ]);
  });

  it("refuses what is no position", () => {
    expect(() => encodeGeometry([[181, 0]])).toThrow(RangeError);
    expect(() => encodeGeometry([[0, -90.0000001]])).toThrow(RangeError);
    expect(() => encodeGeometry([[Number.NaN, 0]])).toThrow(RangeError);
    expect(() => decodeGeometry(Buffer.alloc(12))).toThrow(RangeError);
    expect(() => encodeFixedGeometry(Int32Array.from([1, 2, 3]))).toThrow(RangeError);
  });
});
