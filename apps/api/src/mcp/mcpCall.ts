import type { AuthInfo } from "@modelcontextprotocol/server";
import type { Logger } from "pino";
import type { TokenPrincipal } from "../auth/requestAuth";

/**
 * Who calls `/mcp` and where its log lines go. The router verifies the token
 * before the SDK sees the request; the SDK passes `AuthInfo` through to the
 * per-request server untouched, so the call travels in its `extra`.
 */
export class McpCall {
  readonly principal: TokenPrincipal;
  /** The request's logger (pino-http's child, with the request id). */
  readonly log: Logger;

  constructor(principal: TokenPrincipal, log: Logger) {
    this.principal = principal;
    this.log = log;
  }

  /** The SDK's view of the credential: the token's id, never its secret. */
  toAuthInfo(): AuthInfo {
    return {
      token: this.principal.tokenId,
      clientId: this.principal.tokenId,
      scopes: [...this.principal.scopes],
      extra: { call: this },
    };
  }

  /** The call behind an `AuthInfo`; a request without one never reaches a tool. */
  static of(authInfo: AuthInfo | undefined): McpCall {
    const call = authInfo?.extra?.["call"];
    if (!(call instanceof McpCall)) {
      throw new Error("An MCP request reached the server without a verified API token");
    }
    return call;
  }
}
