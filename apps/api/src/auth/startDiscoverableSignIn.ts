import type { PasskeyOptionsResponse } from "@trail/contracts/auth";
import type { Request } from "express";
import type { AppContext } from "../appContext";
import { authenticationOptions } from "./authenticationOptions";
import { createCeremony } from "./ceremonies";
import { requireCeremonyOrigin } from "./requireCeremonyOrigin";

/** `POST /api/auth/passkey` — usernameless options for conditional UI and "Use a passkey". */
export async function startDiscoverableSignIn(
  ctx: AppContext,
  req: Request,
): Promise<PasskeyOptionsResponse> {
  const { origin, rpId } = requireCeremonyOrigin(req, ctx.config.allowedOrigins);
  const options = await authenticationOptions({ rpId, allowCredentials: [] });
  const ceremonyId = await createCeremony(ctx.db, {
    kind: "authenticate",
    challenge: options.challenge,
    rpId,
    origin,
  });
  return { ceremonyId, options };
}
