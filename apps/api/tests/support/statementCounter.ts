import type { Pool, PoolClient, QueryConfig } from "pg";

type Query = (...args: unknown[]) => unknown;

const textOf = (query: unknown): string =>
  typeof query === "string" ? query : ((query as QueryConfig | undefined)?.text ?? "");

/** A statement's parameters: the second argument, or the config's `values`. */
const valuesOf = (args: readonly unknown[]): readonly unknown[] => {
  const [query, values] = args;
  if (Array.isArray(values)) return values;
  const config = query as QueryConfig | undefined;
  return typeof query === "object" && Array.isArray(config?.values) ? config.values : [];
};

/** A statement as the app sent it. */
export interface WatchedStatement {
  text: string;
  values: readonly unknown[];
  /** What `origin` named when it was sent: the request it came from, for a test that tags them. */
  origin: string | undefined;
}

/** What `watchStatements` gives a test: the statements seen, and a hook after the next one that matches. */
export interface StatementWatch {
  /** Every statement's text since the last `reset`, in order. */
  readonly texts: string[];
  /** The same statements with their parameters. */
  readonly statements: WatchedStatement[];
  reset(): void;
  /**
   * Runs `hook` once, after the next statement whose text matches has
   * answered and before its caller sees the answer: something that happens
   * between two reads of a request.
   */
  after(pattern: RegExp, hook: () => Promise<void>): void;
  stop(): void;
}

/**
 * Watches the statements the app sends through `pool`. They are counted on
 * every client it checks out, which `pool.query` and transactions do alike,
 * so each statement is seen once; the hook waits on whichever promise the
 * caller awaits (`pool.query`'s, or a checked-out client's in a transaction).
 */
export function watchStatements(
  pool: Pool,
  options: { origin?: () => string | undefined } = {},
): StatementWatch {
  const texts: string[] = [];
  const statements: WatchedStatement[] = [];
  const patched = new WeakSet<PoolClient>();
  let pending: { pattern: RegExp; hook: () => Promise<void> } | null = null;
  let watching = true;

  /** The caller's promise of a statement, delayed by the armed hook when it matches. */
  const hooked = (text: string, result: unknown): unknown => {
    const armed = pending;
    if (!watching || armed === null || !(result instanceof Promise) || !armed.pattern.test(text)) {
      return result;
    }
    pending = null;
    return result.then(async (answer: unknown) => {
      await armed.hook();
      return answer;
    });
  };

  const onAcquire = (client: PoolClient) => {
    if (patched.has(client)) return;
    patched.add(client);
    const original = client.query.bind(client) as Query;
    (client as unknown as { query: Query }).query = (...args: unknown[]) => {
      const text = textOf(args[0]);
      if (watching) {
        texts.push(text);
        statements.push({ text, values: valuesOf(args), origin: options.origin?.() });
      }
      return hooked(text, original(...args));
    };
  };
  pool.on("acquire", onAcquire);
  const poolQuery = pool.query.bind(pool) as Query;
  (pool as unknown as { query: Query }).query = (...args: unknown[]) =>
    hooked(textOf(args[0]), poolQuery(...args));

  return {
    texts,
    statements,
    reset() {
      texts.length = 0;
      statements.length = 0;
    },
    after(pattern, hook) {
      pending = { pattern, hook };
    },
    stop() {
      watching = false;
      pending = null;
      pool.off("acquire", onAcquire);
      (pool as unknown as { query: Query }).query = poolQuery;
    },
  };
}
