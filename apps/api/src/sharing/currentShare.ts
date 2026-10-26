import { and, gt, isNull, or, type SQL } from "drizzle-orm";
import { shares } from "../db/schema/shares";

/** Shares in force at `now`: not stopped and not ended (hidden ones included). */
export const currentShare = (now: Date): SQL | undefined =>
  and(isNull(shares.revokedAt), or(isNull(shares.expiresAt), gt(shares.expiresAt, now)));
