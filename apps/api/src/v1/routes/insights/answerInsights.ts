import type { AppContext } from "../../../appContext";
import type { RequestAuth } from "../../../auth/requestAuth";
import { etagMatches } from "../../../cache/etagMatches";
import { weakEtag } from "../../../cache/weakEtag";
import { type InsightsScope, insightsScope } from "../../../insights/insightsScope";
import { insightsValidator } from "../../../insights/insightsValidator";

/**
 * An Insights answer, conditionally (docs/architecture.md §8.9): the scope
 * (devices, period) first, then its validator over `range` (the period by
 * default), a `304` when the request names the ETag, else the answer `load`
 * builds on that same scope.
 */
export async function answerInsights<Body>(input: {
  ctx: AppContext;
  auth: RequestAuth;
  ifNoneMatch: string | undefined;
  operationId: string;
  /** The validated request, as the answer depends on it. */
  asked: unknown;
  query: {
    from?: string | undefined;
    to?: string | undefined;
    devices?: readonly string[] | undefined;
  };
  range?: (scope: InsightsScope) => { startMs: number; endMs: number };
  load: (scope: InsightsScope) => Promise<Body>;
}): Promise<{ status: 304; etag: string } | { status: 200; body: Body; etag: string }> {
  const { ctx, auth } = input;
  const scope = await insightsScope(ctx.db, auth, input.query);
  const range = input.range?.(scope) ?? {
    startMs: scope.start.getTime(),
    endMs: scope.end.getTime(),
  };
  const etag = weakEtag(auth.user.id, input.operationId, [
    input.asked,
    await insightsValidator(ctx.db, scope, range),
  ]);
  if (etagMatches(input.ifNoneMatch, etag)) return { status: 304, etag };
  return { status: 200, body: await input.load(scope), etag };
}
