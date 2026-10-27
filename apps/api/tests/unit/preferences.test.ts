import { defaultPreferences } from "@trail/contracts/preferences";
import { updateMeRequestSchema } from "@trail/contracts/user";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/http/httpError";
import { parseBody } from "../../src/http/parseInput";
import { readPreferences } from "../../src/me/readPreferences";

/** `PATCH /api/me` as the router parses it: the body, or the 400 it answers. */
function patchMe(body: unknown) {
  try {
    return { changes: parseBody(updateMeRequestSchema, { body } as Request) };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status, code: error.code, fields: error.fields };
  }
}

describe("PATCH /api/me preferences", () => {
  it("takes some preferences and leaves the others out", () => {
    expect(patchMe({ preferences: { mapStyle: "dark" } })).toEqual({
      changes: { preferences: { mapStyle: "dark" } },
    });
    expect(
      patchMe({ displayName: "Jens", preferences: { level: "raw", showOwnActivity: true } }),
    ).toEqual({
      changes: { displayName: "Jens", preferences: { level: "raw", showOwnActivity: true } },
    });
  });

  it("refuses a preference it does not know, so nothing else is ever stored", () => {
    expect(patchMe({ preferences: { mapStyle: "dark", theme: "pink" } })).toEqual({
      status: 400,
      code: "validation_failed",
      fields: { preferences: ['Unrecognized key: "theme"'] },
    });
    // As express.json() reads it: `__proto__` is a key of its own, and unknown.
    const polluting = JSON.parse('{"preferences":{"__proto__":{"isAdmin":true},"level":"raw"}}');
    expect(patchMe(polluting)).toEqual({
      status: 400,
      code: "validation_failed",
      fields: { preferences: ['Unrecognized key: "__proto__"'] },
    });
  });

  it("refuses values outside each preference's choices", () => {
    expect(patchMe({ preferences: { mapStyle: "neon" } })).toMatchObject({
      status: 400,
      fields: { "preferences.mapStyle": [expect.any(String)] },
    });
    expect(patchMe({ preferences: { level: "smoothed" } })).toMatchObject({
      status: 400,
      fields: { "preferences.level": [expect.any(String)] },
    });
    expect(patchMe({ preferences: { showOwnActivity: "yes" } })).toMatchObject({
      status: 400,
      fields: { "preferences.showOwnActivity": [expect.any(String)] },
    });
    expect(patchMe({ preferences: null })).toMatchObject({
      status: 400,
      fields: { preferences: [expect.any(String)] },
    });
    expect(patchMe({ preferences: ["dark"] })).toMatchObject({ status: 400 });
  });
});

describe("stored preferences", () => {
  it("fill in every preference that was never set", () => {
    expect(readPreferences({})).toEqual(defaultPreferences);
    expect(readPreferences({ mapStyle: "satellite" })).toEqual({
      ...defaultPreferences,
      mapStyle: "satellite",
    });
  });

  it("read a value this version does not know as the default, and drop other names", () => {
    expect(readPreferences({ mapStyle: "neon", level: "raw", legacy: 1 })).toEqual({
      ...defaultPreferences,
      level: "raw",
    });
    expect(readPreferences(null)).toEqual(defaultPreferences);
    expect(readPreferences("dark")).toEqual(defaultPreferences);
  });
});
