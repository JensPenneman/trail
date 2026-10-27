import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import type { ApiScope } from "@trail/contracts/apiScope";
import type { z } from "zod";
import { hasScope } from "../auth/requestAuth";
import type { McpSession } from "./mcpSession";
import { type McpWork, runMcpWork, type WorkAccess } from "./runMcpWork";

/**
 * What a tool answers: the structured result (put through the output schema
 * on the way out), a short summary for people and for clients that show text
 * only, for the log how many items it holds and whether it was capped, and
 * for the data access log what it read or changed.
 */
export interface ToolAnswer<Output> {
  result: Output;
  text: string;
  items?: number;
  truncated?: boolean;
  access: WorkAccess;
}

export interface ToolSpec<Input extends z.ZodObject, Output extends z.ZodObject> {
  /** snake_case: the name agents call. */
  readonly name: string;
  readonly title: string;
  /** For the agent's model: what the tool answers and when to use it. Never anything a user typed. */
  readonly description: string;
  /** Every one is needed: a token without them neither sees the tool nor can call it. */
  readonly scopes: readonly [ApiScope, ...ApiScope[]];
  readonly input: Input;
  readonly output: Output;
  /** `read` tools run in a read-only transaction; `write` tools open their own. */
  readonly access: "read" | "write";
  /**
   * `false` for a read built on functions that take the whole context and
   * query the pool themselves (`loadPeople`): a transaction would sit idle.
   */
  readonly transaction?: false;
  readonly run: McpWork<z.output<Input>, ToolAnswer<z.input<Output>>>;
}

/** A tool, ready to be registered on the server of a request whose token may use it. */
export interface McpTool {
  readonly name: string;
  readonly scopes: readonly ApiScope[];
  register(server: McpServer, session: McpSession): void;
}

const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const writeAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Defines an MCP tool (docs/mcp.md): the spec feeds `tools/list`, and the
 * handler only ever runs for a token holding every scope — checked when the
 * request's server is built and again on the call. An answer leaves through
 * the output schema, so nothing it does not name gets out; a failure becomes
 * a tool error with a message written for the agent (never a stack, a query
 * or anyone's data); the call is logged without its arguments or its result,
 * and counted in the data access log as `mcp.<name>` with what it read.
 */
export function defineTool<const Input extends z.ZodObject, const Output extends z.ZodObject>(
  spec: ToolSpec<Input, Output>,
): McpTool {
  return {
    name: spec.name,
    scopes: spec.scopes,
    register(server, session) {
      // The SDK sees plain object schemas; its parsed arguments are parsed once more below to
      // get back their type, which a generic schema loses on the way through the SDK's types.
      const inputSchema: z.ZodObject = spec.input;
      const outputSchema: z.ZodObject = spec.output;
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema,
          outputSchema,
          annotations: spec.access === "read" ? readAnnotations : writeAnnotations,
        },
        async (args): Promise<CallToolResult> => {
          const input = spec.input.parse(args);
          const outcome = await runMcpWork(session, {
            kind: "tool",
            name: spec.name,
            executor:
              spec.access === "read" && spec.transaction !== false
                ? "read-only transaction"
                : "pool",
            allowed: spec.scopes.every((scope) => hasScope(session.principal, scope)),
            record: { action: `mcp.${spec.name}`, kind: spec.access },
            work: (context) => spec.run(input, context),
            check: (answer) => {
              const parsed = spec.output.safeParse(answer.result);
              return parsed.success
                ? { ok: true, value: parsed.data }
                : { ok: false, issues: parsed.error.issues };
            },
          });
          if (!outcome.ok) {
            return { content: [{ type: "text", text: outcome.message }], isError: true };
          }
          return {
            content: [{ type: "text", text: outcome.answer.text }],
            structuredContent: outcome.value,
          };
        },
      );
    },
  };
}
