import type { QueryClient } from "@tanstack/react-query";

/*
 * Whether this tab ended its session on purpose — signing out or deleting the
 * account — from the moment the request starts until it fails or the person
 * signs in again. The route guard asks when the session turns up missing: then
 * the sign-in page comes without a way back to the page (`?next=`). Whether the
 * request is still under way is no answer: it settles right after the session
 * is cleared, while the page is still mounted (React Router renders the sign-in
 * page in a transition) and before TanStack Query has told React, so a render
 * of the old page in between saw a lost session and no sign-out.
 */
const endedOnPurpose = new WeakSet<QueryClient>();

export const sessionEndedOnPurpose = {
  mark(queryClient: QueryClient): void {
    endedOnPurpose.add(queryClient);
  },
  /** Ending it failed (the session goes on), or a new session started. */
  unmark(queryClient: QueryClient): void {
    endedOnPurpose.delete(queryClient);
  },
  has(queryClient: QueryClient): boolean {
    return endedOnPurpose.has(queryClient);
  },
};
