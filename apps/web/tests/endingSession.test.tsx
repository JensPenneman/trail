import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { RequireSession } from "../src/app/RequireSession";
import { AboutSection } from "../src/pages/settings/AboutSection";
import { AnnouncerProvider } from "../src/ui/AnnouncerProvider";
import { config, user } from "./support/fixtures";

/** Settings behind the real route guard, signed in, next to a sign-in page. */
function renderSignedIn() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.session, user);
  queryClient.setQueryData(queryKeys.config, config);
  const router = createMemoryRouter(
    [
      { path: "/login", element: <p>Sign-in page</p> },
      {
        element: <RequireSession />,
        children: [{ path: "/settings", element: <AboutSection headingId="about" /> }],
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

/** `fetch` that answers the sign-out only when the test says so. */
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

describe("ending the session", () => {
  it("on purpose ends on the sign-in page without a way back to where it happened", async () => {
    const answer = holdSignOut();
    const { router } = renderSignedIn();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    act(() => answer());
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("");
  });

  it("on purpose stays without a way back when the event stream reports it first", async () => {
    const answer = holdSignOut();
    const { queryClient, router } = renderSignedIn();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    // What the stream's `session-ended` does while the sign-out request is still under way.
    act(() => queryClient.setQueryData(queryKeys.session, null));
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    act(() => answer());
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(router.state.location.search).toBe("");
  });

  it("by itself (revoked elsewhere) offers the way back after signing in again", async () => {
    const { queryClient, router } = renderSignedIn();
    act(() => queryClient.setQueryData(queryKeys.session, null));
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?next=%2Fsettings");
  });
});
