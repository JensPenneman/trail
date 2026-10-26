import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { sessionEndedOnPurpose } from "../src/queries/sessionEndedOnPurpose";
import { sessionQuery } from "../src/queries/sessionQuery";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";

const signedIn = { "GET /api/auth/session": { status: 200, body: { user } } };
const signedOut = {
  "GET /api/auth/session": {
    status: 401,
    body: { error: { code: "unauthorized", message: "Sign in to continue." } },
  },
};

/** A tab that signed out on purpose. */
function signedOutTab(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sessionEndedOnPurpose.mark(queryClient);
  return queryClient;
}

describe("a session ended on purpose", () => {
  it("is forgotten once the session query finds a session (signed in in another tab)", async () => {
    mockApi(signedIn);
    const queryClient = signedOutTab();
    expect(await queryClient.fetchQuery(sessionQuery)).toEqual(user);
    expect(sessionEndedOnPurpose.has(queryClient)).toBe(false);
  });

  it("is kept while there is no session", async () => {
    mockApi(signedOut);
    const queryClient = signedOutTab();
    expect(await queryClient.fetchQuery(sessionQuery)).toBeNull();
    expect(sessionEndedOnPurpose.has(queryClient)).toBe(true);
  });

  it("is kept while the tab is still ending its session", async () => {
    mockApi(signedIn);
    const queryClient = signedOutTab();
    let answer: () => void = () => undefined;
    const signOut = new MutationObserver(queryClient, {
      mutationKey: queryKeys.endSession,
      mutationFn: () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    });
    const ending = signOut.mutate();
    // A session the server still knew before the sign-out reached it.
    expect(await queryClient.fetchQuery(sessionQuery)).toEqual(user);
    expect(sessionEndedOnPurpose.has(queryClient)).toBe(true);
    answer();
    await ending;
  });
});
