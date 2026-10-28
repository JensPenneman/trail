import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { RequireSession } from "../src/app/RequireSession";
import { useSessionUser } from "../src/app/useSessionUser";
import { attachBrowserCache } from "../src/cache/attachBrowserCache";
import { useDevices } from "../src/queries/useDevices";
import { freshIndexedDb, openTestStore, seedEntry, testCache } from "./support/cacheHarness";
import { device, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { createTestQueryClient } from "./support/renderPage";

/** A signed-in page: who it is for and the devices it shows. */
function SignedInPage() {
  const me = useSessionUser();
  const devices = useDevices();
  return (
    <p>
      {me.displayName}: {devices.data?.map((entry) => entry.name).join(", ") ?? "no devices"}
    </p>
  );
}

async function openWithCopy(options: { copy: boolean }) {
  const factory = freshIndexedDb();
  if (options.copy) {
    const store = await openTestStore(factory);
    await seedEntry(store, {
      user,
      queryKey: queryKeys.devices,
      answer: { devices: [device({ name: "Kept phone" })] },
    });
    store.close();
  }
  const queryClient = createTestQueryClient();
  const cache = testCache(factory);
  attachBrowserCache(queryClient, cache);
  cache.prepare();
  const router = createMemoryRouter(
    [
      { path: "/login", element: <p>Sign-in page</p> },
      { element: <RequireSession />, children: [{ path: "/", element: <SignedInPage /> }] },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, cache, router };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a signed-in page without a session check", () => {
  it("paints from the copy, as the account it belongs to, when the probe cannot reach the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await openWithCopy({ copy: true });
    expect(await screen.findByText("Jens: Kept phone")).toBeInTheDocument();
  });

  it("paints from the copy at once when the browser is offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.fn(() => Promise.reject(new TypeError("offline")));
    vi.stubGlobal("fetch", fetch);
    await openWithCopy({ copy: true });
    expect(await screen.findByText("Jens: Kept phone")).toBeInTheDocument();
  });

  it("says the server is unreachable when there is no copy, as before", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await openWithCopy({ copy: false });
    expect(await screen.findByRole("heading", { name: "Trail can’t be reached" })).toBeVisible();
  });

  it("lets the probe decide once it answers: a session that ended goes to sign-in, the copy gone", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const answers: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    );
    const { queryClient, cache, router } = await openWithCopy({ copy: true });
    // The probe never reached the server; the copy is painted meanwhile.
    for (const answer of answers.splice(0)) answer(Response.error());
    expect(await screen.findByText("Jens: Kept phone")).toBeInTheDocument();
    online = true;
    mockApi({
      "GET /api/auth/session": {
        status: 401,
        body: { error: { code: "unauthorized", message: "Signed out" } },
      },
    });
    await queryClient.refetchQueries({ queryKey: queryKeys.session });
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    await expect.poll(() => cache.state().owner).toBeNull();
  });
});
