import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
  hasScope,
  type RequestAuth,
  requireAdmin,
  requireAuth,
  requireSession,
  setRequestAuth,
  type UserRow,
} from "../../src/auth/requestAuth";
import { HttpError } from "../../src/http/httpError";

const user: UserRow = {
  id: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
  email: "jens@example.com",
  displayName: "Jens",
  webauthnUserId: Buffer.alloc(32),
  isAdmin: false,
  timezone: "Europe/Brussels",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const session: RequestAuth = { kind: "session", user, sessionId: "s".repeat(64) };
const token: RequestAuth = {
  kind: "token",
  user,
  tokenId: "t1",
  scopes: ["devices:read"],
  deviceIds: null,
};

/** A request that only ever serves as the key of the principal. */
const requestWith = (auth?: RequestAuth): Request => {
  const req = {} as Request;
  if (auth !== undefined) setRequestAuth(req, auth);
  return req;
};

const failure = (run: () => unknown): { status: number; code: string } | null => {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status, code: error.code };
  }
};

describe("request principals", () => {
  it("give a session every scope and a token only its own", () => {
    expect(hasScope(session, "shares:write")).toBe(true);
    expect(hasScope(token, "devices:read")).toBe(true);
    expect(hasScope(token, "devices:write")).toBe(false);
  });

  it("accept either principal where any will do", () => {
    expect(requireAuth(requestWith(session))).toBe(session);
    expect(requireAuth(requestWith(token))).toBe(token);
    expect(failure(() => requireAuth(requestWith()))).toEqual({
      status: 401,
      code: "unauthorized",
    });
  });

  it("keep session-only work away from API tokens", () => {
    expect(requireSession(requestWith(session)).sessionId).toBe(session.sessionId);
    expect(failure(() => requireSession(requestWith(token)))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(failure(() => requireSession(requestWith()))).toEqual({
      status: 401,
      code: "unauthorized",
    });
  });

  it("let administrators through, whichever their principal", () => {
    const admin: RequestAuth = { ...session, user: { ...user, isAdmin: true } };
    expect(requireAdmin(requestWith(admin))).toBe(admin);
    expect(failure(() => requireAdmin(requestWith(session)))).toEqual({
      status: 403,
      code: "forbidden",
    });
  });
});
