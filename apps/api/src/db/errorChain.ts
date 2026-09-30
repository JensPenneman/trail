/** The error, its `cause` chain and the members of aggregate errors (Node's multi-address connect). */
export function* errorChain(error: unknown, depth = 0): Generator<unknown> {
  if (depth > 8 || error === null || error === undefined) return;
  yield error;
  if (error instanceof AggregateError) {
    for (const inner of error.errors) yield* errorChain(inner, depth + 1);
  }
  if (error instanceof Error && error.cause !== undefined) {
    yield* errorChain(error.cause, depth + 1);
  }
}

/** Every string `code` in the chain (pg SQLSTATEs, Node errno names), outermost first. */
export function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  for (const item of errorChain(error)) {
    if (typeof item === "object" && item !== null && "code" in item) {
      const { code } = item;
      if (typeof code === "string") codes.push(code);
    }
  }
  return codes;
}
