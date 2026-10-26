import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { AppContext } from "../appContext";
import type { TokenPrincipal } from "../auth/requestAuth";
import type { Executor } from "../db/database";
import { errorCodes } from "../db/errorChain";
import { isDatabaseUnavailable } from "../db/isDatabaseUnavailable";
import { HttpError } from "../http/httpError";
import type { McpSession } from "./mcpSession";

/** What a tool or resource sees of the call: one clock, one time zone, one executor. */
export interface WorkContext {
  readonly ctx: AppContext;
  readonly principal: TokenPrincipal;
  /** Reads: a read-only transaction under `mcpStatementTimeout`. Writes go through `ctx.db`. */
  readonly db: Executor;
  /** The instant of the call: ages and defaults are measured from it. */
  readonly now: Date;
  /** The account's time zone: every time in an answer carries its offset. */
  readonly timeZone: string;
}

export type McpWork<Input, Answer> = (input: Input, context: WorkContext) => Promise<Answer>;

/**
 * How long one statement of an MCP read may take. An agent's question is
 * small by construction (31 days, 500 items), and a connection of the shared
 * pool must not sit with an agent for the two minutes the dashboard gets.
 */
export const mcpStatementTimeout = "10s";

type Checked<Value> =
  | { ok: true; value: Value }
  | { ok: false; issues: readonly z.core.$ZodIssue[] };

interface Job<Answer extends Summary, Value> {
  kind: "tool" | "resource";
  name: string;
  access: "read" | "write";
  /** Whether the token holds every scope the tool or resource needs. */
  allowed: boolean;
  work: (context: WorkContext) => Promise<Answer>;
  /** The answer through its output schema: what it does not name is dropped. */
  check: (answer: Answer) => Checked<Value>;
}

interface Summary {
  items?: number;
  truncated?: boolean;
}

export type WorkOutcome<Answer, Value> =
  | { ok: true; answer: Answer; value: Value }
  /** `notFound`: what was asked for is not there (or not for this token); resources answer it in kind. */
  | { ok: false; message: string; notFound: boolean };

const failed = "Something went wrong on the server. It has been logged; try again later.";

/* SQLSTATE 57014: the statement ran into `statement_timeout`. */
const isTimeout = (error: unknown): boolean => errorCodes(error).includes("57014");

/** The message an agent gets for a failure: written for it, never a stack, a query or a value. */
function messageFor(error: unknown): { message: string; expected: boolean } {
  if (error instanceof HttpError && error.status < 500) {
    return { message: error.message, expected: true };
  }
  if (isTimeout(error)) {
    return { message: "This took too long. Ask for a shorter range.", expected: true };
  }
  if (isDatabaseUnavailable(error)) {
    return {
      message: "Trail's database is unavailable for a moment. Try again shortly.",
      expected: true,
    };
  }
  return { message: failed, expected: false };
}

/**
 * Runs one tool call or resource read for an MCP session (docs/mcp.md):
 * re-checks the scopes, runs reads in a read-only transaction with a short
 * statement timeout, puts the answer through its schema and logs the call —
 * its name, duration, outcome and size at info, never its arguments, its
 * result or the token.
 */
export async function runMcpWork<Answer extends Summary, Value>(
  session: McpSession,
  job: Job<Answer, Value>,
): Promise<WorkOutcome<Answer, Value>> {
  const started = performance.now();
  const line = (fields: Record<string, unknown>) => ({
    mcp: {
      [job.kind]: job.name,
      durationMs: Math.round(performance.now() - started),
      ...fields,
    },
    tokenId: session.principal.tokenId,
  });
  if (!job.allowed) {
    session.log.warn(line({ outcome: "refused" }), "MCP call without its scopes");
    return { ok: false, message: "This API token lacks a scope that this needs.", notFound: false };
  }
  const base = {
    ctx: session.ctx,
    principal: session.principal,
    now: new Date(),
    timeZone: session.principal.user.timezone,
  };
  try {
    const answer =
      job.access === "read"
        ? await session.ctx.db.transaction(
            async (tx) => {
              await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${mcpStatementTimeout}'`));
              return job.work({ ...base, db: tx });
            },
            { accessMode: "read only" },
          )
        : await job.work({ ...base, db: session.ctx.db });
    const checked = job.check(answer);
    if (!checked.ok) {
      session.log.error(
        {
          ...line({ outcome: "failed" }),
          issues: checked.issues.map(({ code, path }) => ({ code, path })),
        },
        "MCP answer does not match its schema",
      );
      return { ok: false, message: failed, notFound: false };
    }
    session.log.info(
      line({
        outcome: "ok",
        resultBytes: Buffer.byteLength(JSON.stringify(checked.value)),
        ...(answer.items === undefined ? {} : { items: answer.items }),
        ...(answer.truncated === true ? { truncated: true } : {}),
      }),
      `MCP ${job.kind}`,
    );
    return { ok: true, answer, value: checked.value };
  } catch (error) {
    const { message, expected } = messageFor(error);
    if (expected) {
      session.log.info(line({ outcome: "refused" }), `MCP ${job.kind}`);
    } else {
      session.log.error({ ...line({ outcome: "failed" }), err: error }, `MCP ${job.kind} failed`);
    }
    return {
      ok: false,
      message,
      notFound: error instanceof HttpError && error.status === 404,
    };
  }
}
