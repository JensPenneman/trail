import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, use } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { RequireSession } from "../src/app/RequireSession";
import { useCompleteSignIn } from "../src/auth/useCompleteSignIn";
import { AboutSection } from "../src/pages/settings/AboutSection";
import { DeleteAccountDialog } from "../src/pages/settings/DeleteAccountDialog";
import { AnnouncerProvider } from "../src/ui/AnnouncerProvider";
import { config, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";

/** Settings behind the real route guard, signed in, next to a sign-in page. */
function renderSignedIn({
  settings = <AboutSection headingId="about" />,
  signIn = <p>Sign-in page</p>,
}: {
  settings?: ReactNode;
  signIn?: ReactNode;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.session, user);
  queryClient.setQueryData(queryKeys.config, config);
  const router = createMemoryRouter(
    [
      { path: "/login", element: signIn },
      {
        element: <RequireSession />,
        children: [{ path: "/settings", element: settings }],
      },
    ],
    { initialEntries: ["/settings"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AnnouncerProvider>
        <RouterProvider router={router} />
      </AnnouncerProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

/** `fetch` that answers the sign-out (or account deletion) only when the test says so. */
function holdSignOut() {
  let answer: (response: Response) => void = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ),
  );
  return () => answer(new Response(null, { status: 204 }));
}

/**
 * A sign-in page that cannot render until `show()`. React Router renders the
 * next route in a transition, so the page that was shown stays mounted until
 * the sign-in page is ready — on a busy machine long enough for the old page to
 * see the session go. Holding the sign-in page back stretches that moment for
 * as long as the test needs: the old page sees it every run, not one in fifteen.
 */
function holdSignInPage() {
  let show: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    show = resolve;
  });
  function SignInPage() {
    use(ready);
    return <p>Sign-in page</p>;
  }
  return { page: <SignInPage />, show: () => act(async () => show()) };
}

/** TanStack Query tells React about cache changes on a timer; one timer later, React knows. */
const reactHeardFromQuery = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** A sign-in page that signs the person in again at the press of a button. */
function SignInAgain() {
  const completeSignIn = useCompleteSignIn("/settings");
  return (
    <button type="button" onClick={() => completeSignIn(user)}>
      Sign in again
    </button>
  );
}

describe("ending the session", () => {
  it("on purpose ends on the sign-in page without a way back to where it happened", async () => {
    const answer = holdSignOut();
    const signIn = holdSignInPage();
    const { router } = renderSignedIn({ signIn: signIn.page });
    const signOut = screen.getByRole("button", { name: "Sign out" });
    await userEvent.setup().click(signOut);
    act(() => answer());
    // The sign-out is done and the session cleared while Settings is still shown (the
    // sign-in page is not ready yet): the route guard sees the session go and takes over.
    await waitForElementToBeRemoved(signOut);
    await signIn.show();
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("");
  });

  it("on purpose stays without a way back when the event stream reports it first", async () => {
    const answer = holdSignOut();
    const signIn = holdSignInPage();
    const { queryClient, router } = renderSignedIn({ signIn: signIn.page });
    const signOut = screen.getByRole("button", { name: "Sign out" });
    await userEvent.setup().click(signOut);
    // What the stream's `session-ended` does while the sign-out request is still under way.
    act(() => queryClient.setQueryData(queryKeys.session, null));
    await waitForElementToBeRemoved(signOut);
    // The request returns while Settings is still mounted, on its way out.
    act(() => answer());
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await reactHeardFromQuery();
    await signIn.show();
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("");
  });

  it("by deleting the account ends on the sign-in page without a way back", async () => {
    const answer = holdSignOut();
    const signIn = holdSignInPage();
    const { router } = renderSignedIn({
      settings: <DeleteAccountDialog open onClose={() => undefined} />,
      signIn: signIn.page,
    });
    const events = userEvent.setup();
    await events.type(screen.getByLabelText(`Type ${user.email} to confirm`), user.email);
    const remove = screen.getByRole("button", { name: "Delete account" });
    await events.click(remove);
    act(() => answer());
    await waitForElementToBeRemoved(remove);
    await signIn.show();
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("");
  });

  it("by itself (revoked elsewhere) offers the way back after signing in again", async () => {
    const { queryClient, router } = renderSignedIn();
    act(() => queryClient.setQueryData(queryKeys.session, null));
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?next=%2Fsettings");
  });

  it("by itself after a sign-out that failed still offers the way back", async () => {
    mockApi({
      "POST /api/auth/logout": {
        status: 503,
        body: { error: { code: "unavailable", message: "Trail is restarting." } },
      },
    });
    const { queryClient, router } = renderSignedIn();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Signing out failed")).toBeInTheDocument();
    act(() => queryClient.setQueryData(queryKeys.session, null));
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?next=%2Fsettings");
  });

  it("by itself after a session came back without the sign-in page offers the way back", async () => {
    mockApi({
      "POST /api/auth/logout": { status: 204 },
      "GET /api/auth/session": { status: 200, body: { user } },
    });
    const { queryClient, router } = renderSignedIn();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    // Signed in again in another tab: this tab's session query finds that session.
    await act(() => queryClient.refetchQueries({ queryKey: queryKeys.session }));
    await act(() => router.navigate("/settings"));
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
    act(() => queryClient.setQueryData(queryKeys.session, null));
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?next=%2Fsettings");
  });

  it("by itself after signing out and in again offers the way back", async () => {
    const answer = holdSignOut();
    const { queryClient, router } = renderSignedIn({ signIn: <SignInAgain /> });
    const events = userEvent.setup();
    await events.click(screen.getByRole("button", { name: "Sign out" }));
    act(() => answer());
    await events.click(await screen.findByRole("button", { name: "Sign in again" }));
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
    act(() => queryClient.setQueryData(queryKeys.session, null));
    expect(await screen.findByRole("button", { name: "Sign in again" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?next=%2Fsettings");
  });
});
