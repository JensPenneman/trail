import type { V1Route } from "../../defineRoute";
import { verifyToken } from "./verifyToken";

/** The token operations, in the order of the reference. Tokens are managed in Settings, not here. */
export const tokenRoutes: readonly V1Route[] = [verifyToken];
