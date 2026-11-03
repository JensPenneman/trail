import { describe, expect, it } from "vitest";
import { createStaleBundleCheck } from "../src/map/staleBundle";

const tile404 = {
  status: 404,
  url: "https://trail.example/map/tiles/0123456789abcdef/5/16/10.pbf",
};

describe("the check for a pruned basemap bundle", () => {
  it("fires for a 404 of a basemap tile, at most once a minute", () => {
    let time = 1_000_000;
    const check = createStaleBundleCheck(() => time);
    expect(check(tile404)).toBe(true);
    time += 59_999;
    expect(check(tile404)).toBe(false);
    time += 1;
    expect(check(tile404)).toBe(true);
  });

  it("ignores other errors and other URLs, without using up the minute", () => {
    const check = createStaleBundleCheck(() => 5);
    expect(check({ status: 500, url: tile404.url })).toBe(false);
    expect(
      check({ status: 404, url: "https://trail.example/map/assets/x/fonts/a/0-255.pbf" }),
    ).toBe(false);
    expect(check(new Error("boom"))).toBe(false);
    expect(check(undefined)).toBe(false);
    expect(check(tile404)).toBe(true);
  });
});
