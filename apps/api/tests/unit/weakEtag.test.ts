import { describe, expect, it } from "vitest";
import { etagMatches } from "../../src/cache/etagMatches";
import { weakEtag } from "../../src/cache/weakEtag";

const owner = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60";
const other = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a61";

describe("weakEtag", () => {
  it("is a weak validator of 22 base64url characters", () => {
    expect(weakEtag(owner, "/api/tracks", ["raw1|a"])).toMatch(/^W\/"[A-Za-z0-9_-]{22}"$/);
  });

  it("is stable: the same owner, route and validator give the same ETag", () => {
    const validator = [{ from: "2026-10-26T23:00:00.000Z" }, ["raw1|x", "raw1|y"]];
    expect(weakEtag(owner, "/api/tracks", validator)).toBe(
      weakEtag(owner, "/api/tracks", structuredClone(validator)),
    );
  });

  it("has the owner in it: one account's ETag never matches another's answer", () => {
    expect(weakEtag(owner, "/api/tracks", ["raw1|x"])).not.toBe(
      weakEtag(other, "/api/tracks", ["raw1|x"]),
    );
  });

  it("has the route and the question in it", () => {
    const validator = ["raw1|x"];
    expect(weakEtag(owner, "/api/tracks", validator)).not.toBe(
      weakEtag(owner, "/api/visits", validator),
    );
    expect(weakEtag(owner, "/api/tracks", [{ maxPoints: 100 }, validator])).not.toBe(
      weakEtag(owner, "/api/tracks", [{ maxPoints: 200 }, validator]),
    );
  });

  it("changes with any part of the validator", () => {
    expect(weakEtag(owner, "/api/tracks", ["raw1|x"])).not.toBe(
      weakEtag(owner, "/api/tracks", ["raw1|y"]),
    );
    // Parts cannot run into each other: a separator inside one is not a new part.
    expect(weakEtag(owner, "/api/tracks", ["a|b", "c"])).not.toBe(
      weakEtag(owner, "/api/tracks", ["a", "b|c"]),
    );
  });
});

describe("etagMatches", () => {
  const etag = 'W/"q8Zr2mXnB4vT1cKd9LsE0a"';

  it("matches the tag itself, weak or strong", () => {
    expect(etagMatches(etag, etag)).toBe(true);
    expect(etagMatches('"q8Zr2mXnB4vT1cKd9LsE0a"', etag)).toBe(true);
  });

  it("matches any tag of a list, however it is spaced", () => {
    expect(etagMatches(`"a", ${etag}`, etag)).toBe(true);
    expect(etagMatches(`W/"a",${etag} , "b"`, etag)).toBe(true);
  });

  it("matches * (any current answer, as Express's own check does)", () => {
    expect(etagMatches("*", etag)).toBe(true);
    expect(etagMatches(" * ", etag)).toBe(true);
  });

  it("matches nothing else", () => {
    expect(etagMatches(undefined, etag)).toBe(false);
    expect(etagMatches("", etag)).toBe(false);
    expect(etagMatches('W/"q8Zr2mXnB4vT1cKd9LsE0b"', etag)).toBe(false);
    // Unquoted, or only part of the tag: malformed, so it names nothing.
    expect(etagMatches("q8Zr2mXnB4vT1cKd9LsE0a", etag)).toBe(false);
    expect(etagMatches('W/"q8Zr2mXnB4vT1cKd9LsE0', etag)).toBe(false);
    expect(etagMatches('"q8Zr2mXnB4vT1cKd9LsE0a-and-more"', etag)).toBe(false);
  });
});
