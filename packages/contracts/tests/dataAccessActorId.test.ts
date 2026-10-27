import { describe, expect, it } from "vitest";
import {
  actorIdOf,
  dataAccessActorId,
  dataAccessActorIdSchema,
  parseDataAccessActorId,
} from "../src/dataAccessActorId";

const ana = "01926f3a-8b2c-7d4e-9f10-2a3b4c5d6e80";
const token = "01926f3e-4a71-7c93-a465-7f8091a2b3c4";
const link = "019a2b4f-0c33-7a51-8d4e-6b7f1c2d3e4f";

describe("actor ids of the data access log", () => {
  it("name a person, a token, a link or one of your browsers, and read back", () => {
    const refs = [
      { kind: "person", userId: ana },
      { kind: "token", tokenId: token },
      { kind: "link", linkId: link },
      { kind: "session", label: "Safari on iPhone" },
    ] as const;
    for (const ref of refs) {
      const id = dataAccessActorId(ref);
      expect(parseDataAccessActorId(id)).toEqual(ref);
      expect(dataAccessActorIdSchema.safeParse(id).success).toBe(true);
    }
    expect(dataAccessActorId(refs[0])).toBe(`person:${ana}`);
    expect(dataAccessActorId(refs[3])).toBe("session:Safari on iPhone");
    // A browser's name may hold a colon of its own.
    expect(parseDataAccessActorId("session:Kiosk: lobby")).toEqual({
      kind: "session",
      label: "Kiosk: lobby",
    });
  });

  it("take the actor of a line, a link's visitors as the link", () => {
    expect(actorIdOf({ kind: "owner", sessionLabel: "Firefox on Mac" })).toBe(
      "session:Firefox on Mac",
    );
    expect(
      actorIdOf({
        kind: "link",
        linkId: link,
        linkLabel: "Home",
        visitor: { key: "7d1c0a9e4b2f8c31", ipCoarse: "81.82.83.0/24", uaFamily: "Mac · Safari" },
      }),
    ).toBe(`link:${link}`);
    expect(actorIdOf({ kind: "person", userId: ana, displayName: "Ana", shareId: null })).toBe(
      `person:${ana}`,
    );
    expect(actorIdOf({ kind: "token", tokenId: token, tokenName: "Home Assistant" })).toBe(
      `token:${token}`,
    );
  });

  it("refuse anything else", () => {
    for (const value of [
      "",
      ana,
      `admin:${ana}`,
      "person:not-a-uuid",
      `person:${ana}x`,
      "session:",
      `session:${"x".repeat(121)}`,
      "session:Safari\non iPhone",
    ]) {
      expect(parseDataAccessActorId(value), value).toBeNull();
      expect(dataAccessActorIdSchema.safeParse(value).success, value).toBe(false);
    }
    // Upper-case UUIDs are the same account.
    expect(parseDataAccessActorId(`token:${token.toUpperCase()}`)).toEqual({
      kind: "token",
      tokenId: token,
    });
  });
});
