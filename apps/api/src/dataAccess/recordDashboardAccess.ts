import type { DataAccessKind, DataAccessResource } from "@trail/contracts/dataAccess";
import type { Request } from "express";
import type { AppContext } from "../appContext";
import { getRequestAuth } from "../auth/requestAuth";
import { principalActor } from "./principalActor";

/**
 * Counts what a route of the dashboard's private API read or changed in the
 * owner's data access log (docs/architecture.md §8.7): their browser session,
 * channel `web`, action `dashboard.<route>`. Each recorded handler calls it
 * once its answer is out (an export once it starts streaming); the device
 * list, configuration and health are not recorded. Never throws.
 */
export function recordDashboardAccess(
  ctx: AppContext,
  req: Request,
  access: { action: string; kind: DataAccessKind; resource: DataAccessResource; status?: number },
): void {
  try {
    const auth = getRequestAuth(req);
    if (auth === undefined) return;
    ctx.dataAccess.record({
      ...principalActor(auth, req.get("user-agent") ?? null),
      ownerUserId: auth.user.id,
      action: `dashboard.${access.action}`,
      access: access.kind,
      resource: access.resource,
      status: access.status ?? 200,
    });
  } catch (error) {
    (req.log ?? ctx.logger).error(
      { err: error, action: access.action },
      "data access not recorded",
    );
  }
}
