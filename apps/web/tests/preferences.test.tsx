import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Preferences } from "@trail/contracts/preferences";
import type { SessionUser } from "@trail/contracts/user";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { RequireSession } from "../src/app/RequireSession";
import { resolveMapStyleChoice, useMapStyle } from "../src/map/useMapStyle";
import { PreferencesPage } from "../src/pages/settings/PreferencesPage";
import { resolveTrackLevel, useTrackLevel } from "../src/transport/useTrackLevel";
import { config, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

const withPreferences = (preferences: Partial<Preferences>): SessionUser => ({
  ...user,
  preferences: { ...user.preferences, ...preferences },
});

/** What the map would open with: its style choice and the level of its tracks. */
function MapDefaults() {
  const { choice } = useMapStyle();
  const { level } = useTrackLevel();
  return (
    <p>
      style {choice}, level {level}
    </p>
  );
}

/**
 * `element` behind the real route guard, so the session (and its preferences)
 * is the query's; `PATCH /api/me` merges preferences as the server does.
 */
function renderSignedIn(element: React.ReactElement, url: string, account: SessionUser) {
  let current = account;
  const api = mockApi({
    ...standardRoutes(),
    "GET /api/auth/session": () => ({ status: 200, body: { user: current } }),
    "PATCH /api/me": ({ body }) => {
      const { preferences } = body as { preferences: Partial<Preferences> };
      current = { ...current, preferences: { ...current.preferences, ...preferences } };
      return { status: 200, body: { user: current } };
    },
  });
  const view = renderPage(null, {
    url,
    routes: [
      {
        element: <RequireSession />,
        children: [
          { path: "/", element },
          { path: "/settings/preferences", element },
        ],
      },
    ],
  });
  return { ...api, ...view };
}

describe("the map's defaults", () => {
  it("come from the address, then this browser, then the account, then Trail", () => {
    expect(resolveTrackLevel("raw", "mapped", "averaged")).toBe("raw");
    expect(resolveTrackLevel(null, "mapped", "averaged")).toBe("mapped");
    expect(resolveTrackLevel("smoothed", null, "averaged")).toBe("averaged");
    expect(resolveTrackLevel(null, null, undefined)).toBe("inferred");
    expect(resolveMapStyleChoice("light", "satellite", "dark")).toBe("light");
    expect(resolveMapStyleChoice(null, "satellite", "dark")).toBe("satellite");
    expect(resolveMapStyleChoice("neon", null, "dark")).toBe("dark");
    expect(resolveMapStyleChoice(null, null, undefined)).toBe("auto");
  });

  it("follow the account's preferences where nothing else says otherwise", async () => {
    renderSignedIn(<MapDefaults />, "/", withPreferences({ mapStyle: "dark", level: "raw" }));
    expect(await screen.findByText("style dark, level raw")).toBeInTheDocument();
  });

  it("give way to this browser's last choice and to the address", async () => {
    window.localStorage.setItem("trail.mapStyle", "light");
    window.localStorage.setItem("trail.level", "mapped");
    try {
      renderSignedIn(
        <MapDefaults />,
        "/?level=averaged",
        withPreferences({ mapStyle: "dark", level: "raw" }),
      );
      expect(await screen.findByText("style light, level averaged")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
    }
  });

  it("are Trail's own on a page without a session (a public link)", async () => {
    mockApi(standardRoutes());
    renderPage(<MapDefaults />, { path: "/s", user: null });
    expect(await screen.findByText("style auto, level inferred")).toBeInTheDocument();
  });
});

describe("Settings › Preferences", () => {
  it("saves a choice at once, says so, and makes this browser follow it again", async () => {
    window.localStorage.setItem("trail.mapStyle", "light");
    const person = userEvent.setup();
    const { calls, queryClient } = renderSignedIn(
      <>
        <PreferencesPage />
        <MapDefaults />
      </>,
      "/settings/preferences",
      user,
    );
    const style = await screen.findByRole("combobox", { name: "Map style" });
    expect(style).toHaveValue("auto");
    expect(style).toHaveAccessibleDescription("Auto is light or dark, as the system is set.");
    // No satellite imagery on this server: no Satellite to choose.
    expect(within(style).queryByRole("option", { name: "Satellite" })).not.toBeInTheDocument();
    expect(screen.getByText("style light, level inferred")).toBeInTheDocument();

    await person.selectOptions(style, "dark");
    await waitFor(() =>
      expect(calls.filter((call) => call.method === "PATCH").map((call) => call.body)).toEqual([
        { preferences: { mapStyle: "dark" } },
      ]),
    );
    expect(await screen.findByText("Map style saved: Dark.")).toBeInTheDocument();
    expect(window.localStorage.getItem("trail.mapStyle")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Map style" })).toHaveValue("dark");
    expect(screen.getByText("style dark, level inferred")).toBeInTheDocument();
    expect(queryClient.getQueryData<SessionUser>(queryKeys.session)?.preferences.mapStyle).toBe(
      "dark",
    );
  });

  it("switches the own activity of the access log", async () => {
    const person = userEvent.setup();
    const { calls } = renderSignedIn(<PreferencesPage />, "/settings/preferences", user);
    const own = await screen.findByRole("switch", { name: "Your own activity" });
    expect(own).not.toBeChecked();
    await person.click(own);
    await waitFor(() =>
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
        preferences: { showOwnActivity: true },
      }),
    );
    expect(
      await screen.findByText("The access log lists your own activity too."),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Your own activity" })).toBeChecked();
  });

  it("shows a switched preference at once, before the answer arrives", async () => {
    const { fetchMock } = mockApi({
      ...standardRoutes(),
      "GET /api/auth/session": { status: 200, body: { user } },
    });
    const held: { answer?: (response: Response) => void } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PATCH"
          ? new Promise<Response>((resolve) => {
              held.answer = resolve;
            })
          : fetchMock(input, init),
      ),
    );
    renderPage(null, {
      url: "/settings/preferences",
      routes: [
        {
          element: <RequireSession />,
          children: [{ path: "/settings/preferences", element: <PreferencesPage /> }],
        },
      ],
    });
    const own = await screen.findByRole("switch", { name: "Your own activity" });
    // Checked in the same turn as the click: not a moment back to off while the change is on its way.
    fireEvent.click(own);
    expect(own).toBeChecked();
    await waitFor(() => expect(held.answer).toBeDefined());
    expect(own).toBeChecked();
    held.answer?.(
      new Response(JSON.stringify({ user: withPreferences({ showOwnActivity: true }) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(
      await screen.findByText("The access log lists your own activity too."),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Your own activity" })).toBeChecked();
  });

  it("goes back to what was saved when a change fails", async () => {
    const person = userEvent.setup();
    mockApi({
      ...standardRoutes(),
      "PATCH /api/me": {
        status: 503,
        body: { error: { code: "unavailable", message: "Trail is restarting." } },
      },
    });
    renderPage(null, {
      url: "/settings/preferences",
      routes: [
        {
          element: <RequireSession />,
          children: [{ path: "/settings/preferences", element: <PreferencesPage /> }],
        },
      ],
    });
    const level = await screen.findByRole("combobox", { name: "Detail of the tracks" });
    expect(level).toHaveValue("inferred");
    await person.selectOptions(level, "raw");
    expect(await screen.findByText("That preference was not saved")).toBeInTheDocument();
    expect(screen.getByText("Trail is restarting.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Detail of the tracks" })).toHaveValue("inferred");
  });

  it("offers Satellite where the server has imagery", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/config": {
        status: 200,
        body: {
          ...config,
          mapStyles: {
            ...config.mapStyles,
            satellite: {
              kind: "raster",
              tiles: "https://imagery.example.com/{z}/{x}/{y}.png",
              attribution: "Imagery",
            },
          },
        },
      },
    });
    renderPage(<PreferencesPage />, { path: "/settings/preferences", user });
    const style = await screen.findByRole("combobox", { name: "Map style" });
    expect(await within(style).findByRole("option", { name: "Satellite" })).toBeInTheDocument();
  });
});
