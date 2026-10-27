import type { Logger } from "pino";
import type { AppContext } from "../appContext";
import type { TokenPrincipal } from "../auth/requestAuth";

/**
 * Everything the tools and resources of one MCP request share: the app, the
 * token that called and the request's logger. One server is built per request
 * around it, so nothing of one caller can reach another.
 */
export interface McpSession {
  readonly ctx: AppContext;
  readonly principal: TokenPrincipal;
  readonly log: Logger;
}
