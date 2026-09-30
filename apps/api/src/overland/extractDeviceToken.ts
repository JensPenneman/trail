import type { Request } from "express";

const tokenPattern = /^trl_[A-Za-z0-9_-]{43}$/;

/**
 * The device token: `Authorization: Bearer …`, or `?token=` / `?access_token=`
 * for clients that cannot set headers. Anything not shaped like a Trail token
 * is treated as missing, which saves a database lookup.
 */
export function extractDeviceToken(req: Request): string | null {
  const header = req.get("authorization");
  const bearer = header === undefined ? null : (/^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] ?? null);
  const fromQuery = [req.query["token"], req.query["access_token"]].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const token = bearer ?? fromQuery ?? null;
  return token !== null && tokenPattern.test(token) ? token : null;
}
