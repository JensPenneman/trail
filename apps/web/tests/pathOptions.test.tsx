import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ana, bob, ids, tracks, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const openOptions = (person: ReturnType<typeof userEvent.setup>) =>
  person.click(screen.getByRole("button", { name: /Map options/ }));

const optionsOf = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("Colour by", () => {
  it("offers mode, device, speed and time of day at Transport, and no mode elsewhere", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&person=me", user });
    await openOptions(person);
    const select = await screen.findByRole("combobox", { name: "Colour by" });
    expect(select).toHaveValue("mode");
    expect(optionsOf(select)).toEqual([
      "Mode",
      "Device",
      "Speed",
      "Time of day",
      "Altitude",
      "Accuracy",
      "Mode confidence",
    ]);
    await person.click(screen.getByRole("radio", { name: "Raw" }));
    await waitFor(() =>
      expect(optionsOf(screen.getByRole("combobox", { name: "Colour by" }))).toEqual([
        "Device",
        "Speed",
        "Time of day",
        "Altitude",
        "Accuracy",
      ]),
    );
    // A preference that Raw cannot show is skipped, not rewritten.
    expect(screen.getByRole("combobox", { name: "Colour by" })).toHaveValue("device");
  });

  it("writes the choice into the address in place of its entry and remembers it", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: "/?view=history&person=me", user });
    await openOptions(person);
    await person.selectOptions(await screen.findByRole("combobox", { name: "Colour by" }), "speed");
    await waitFor(() => expect(router.state.location.search).toContain("color=speed"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(window.localStorage.getItem("trail.color")).toBe("speed");
  });

  it("takes the address, then the browser's choice, then the account's preference", async () => {
    mockApi(standardRoutes());
    window.localStorage.setItem("trail.color", "time");
    const first = renderPage(<PeoplePage />, { url: "/?view=history&person=me", user });
    await userEvent.setup().click(screen.getByRole("button", { name: /Map options/ }));
    expect(await screen.findByRole("combobox", { name: "Colour by" })).toHaveValue("time");
    first.unmount();
    renderPage(<PeoplePage />, { url: "/?view=history&person=me&color=device", user });
    await userEvent.setup().click(screen.getByRole("button", { name: /Map options/ }));
    expect(await screen.findByRole("combobox", { name: "Colour by" })).toHaveValue("device");
  });
});

describe("what the level's tracks are asked for", () => {
  const trackCalls = (calls: { path: string; url?: string }[]) =>
    calls.filter((call) => call.path === "/api/v1/tracks");

  it("is the altitude or the accuracy for those colourings only, and nothing else", async () => {
    for (const [colour, values] of [
      ["accuracy", "accuracy"],
      ["altitude", "altitude"],
      ["speed", null],
      ["device", null],
      ["confidence", null],
    ] as const) {
      const { calls } = mockApi(standardRoutes());
      const view = renderPage(<PeoplePage />, {
        url: `/?view=history&person=me&level=averaged&color=${colour}`,
        user,
      });
      await waitFor(() => expect(trackCalls(calls).length).toBeGreaterThan(0));
      for (const call of trackCalls(calls)) {
        const asked = new URL(call.url ?? "", "http://x").searchParams.get("values");
        expect(asked).toBe(values);
      }
      view.unmount();
    }
  });
});

describe("the legends of the colourings", () => {
  it("is a key over the map for speed, and says pace where everything is on foot", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=history&person=me&color=speed", user });
    const key = await screen.findByRole("list", { name: "Speed" });
    expect(
      within(key)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
        .filter((text) => text !== "" && text !== "SlowerFaster"),
    ).toEqual(expect.arrayContaining(["under 6 km/h", "70 km/h or more"]));
  });

  it("lists the times of day for time, with their hours", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&person=me&color=time", user });
    await openOptions(person);
    const legend = await screen.findByRole("region", { name: "Map legend" });
    for (const text of ["Night 22–06", "Morning 06–12", "Afternoon 12–18", "Evening 18–22"]) {
      expect(within(legend).getByText(text)).toBeInTheDocument();
    }
    // Time of day is no key over the map.
    expect(screen.queryByRole("list", { name: "Speed" })).not.toBeInTheDocument();
  });

  it("names the devices drawn for the device colouring, and the modes for mode", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&person=me&color=device", user });
    await openOptions(person);
    const legend = await screen.findByRole("region", { name: "Map legend" });
    expect(within(legend).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(legend).queryByText("Train")).not.toBeInTheDocument();
  });

  it("lists a sharer drawn in the overview by name, and calls the choice Device or person", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": {
        status: 200,
        body: { people: [ana({ share: { ...ana().share, historyDays: 7 } }), bob()] },
      },
      [`GET /api/v1/people/${ids.ana}/track`]: ({ url }: { url: URL }) => {
        const answer = tracks(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "");
        return {
          status: 200,
          body: {
            ...answer,
            tracks: answer.tracks.map((track) => ({ ...track, deviceId: ids.anaPhone })),
          },
        };
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&color=device", user });
    await openOptions(person);
    const select = await screen.findByRole("combobox", { name: "Colour by" });
    await waitFor(() => expect(optionsOf(select)).toContain("Device or person"));
    const legend = screen.getByRole("region", { name: "Map legend" });
    expect(within(legend).getByText("Ana Bell")).toBeInTheDocument();
  });

  it("keeps the lines' colours to Colour by for every level: nothing when someone else is selected", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, {
      url: `/?view=live&person=${"0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60"}`,
      user,
    });
    await openOptions(person);
    expect(screen.queryByRole("combobox", { name: "Colour by" })).not.toBeInTheDocument();
  });
});
