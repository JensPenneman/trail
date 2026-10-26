import { McpServer } from "@modelcontextprotocol/server";
import { hasScope } from "../auth/requestAuth";
import { mcpInstructions } from "./mcpInstructions";
import type { McpSession } from "./mcpSession";
import { mcpTools } from "./mcpTools";
import { registerDeviceResources } from "./resources/deviceResources";

/**
 * The MCP server of one request (docs/mcp.md): name `trail`, the build's
 * version, the instructions, and only the tools and resources the token's
 * scopes allow — a tool it may not use is not listed, and calling it answers
 * like a tool that does not exist. Nothing announces changes (no
 * `listChanged`, no subscriptions): a client that listens is acknowledged and
 * let go at once instead of holding a stream open.
 */
export function createTrailMcpServer(session: McpSession): McpServer {
  const { ctx, principal } = session;
  const server = new McpServer(
    { name: "trail", title: "Trail", version: ctx.config.build.version },
    {
      instructions: mcpInstructions(principal.user.timezone, new Date()),
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
    },
  );
  for (const tool of mcpTools) {
    if (tool.scopes.every((scope) => hasScope(principal, scope))) tool.register(server, session);
  }
  registerDeviceResources(server, session);
  return server;
}
