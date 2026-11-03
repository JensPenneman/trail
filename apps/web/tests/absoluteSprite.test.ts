import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { absoluteSprite } from "../src/map/absoluteSprite";

const style = (sprite: StyleSpecification["sprite"]): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [],
  ...(sprite === undefined ? {} : { sprite }),
});

describe("absoluteSprite", () => {
  it("resolves the server's sprite path against the page's own address", () => {
    const origin = window.location.origin;
    expect(
      absoluteSprite(undefined, style("/map/assets/0123456789abcdef/sprites/ofm")).sprite,
    ).toBe(`${origin}/map/assets/0123456789abcdef/sprites/ofm`);
    expect(
      absoluteSprite(
        undefined,
        style([{ id: "default", url: "/map/assets/0123456789abcdef/sprites/ofm" }]),
      ).sprite,
    ).toEqual([{ id: "default", url: `${origin}/map/assets/0123456789abcdef/sprites/ofm` }]);
  });

  it("leaves another server's sprite and a style without one as they are", () => {
    const external = style("https://tiles.example.com/sprites/ofm");
    expect(absoluteSprite(undefined, external)).toEqual(external);
    const none = style(undefined);
    expect(absoluteSprite(undefined, none)).toBe(none);
  });
});
