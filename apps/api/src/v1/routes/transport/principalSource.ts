import type { ModeOverrideSource } from "@trail/contracts/transport";
import type { RequestAuth } from "../../../auth/requestAuth";

/** Who set a mode through the API: the dashboard's session, or an API token. */
export const principalSource = (auth: RequestAuth): ModeOverrideSource =>
  auth.kind === "session" ? "ui" : "api";
