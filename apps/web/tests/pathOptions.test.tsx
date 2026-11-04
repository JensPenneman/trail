import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { user } from "./support/fixtures";
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
    expect(optionsOf(select)).toEqual(["Mode", "Device", "Speed", "Time of day"]);
    await person.click(screen.getByRole("radio", { name: "Raw" }));
    await waitFor(() =>
      expect(optionsOf(screen.getByRole("combobox", { name: "Colour by" }))).toEqual([
        "Device",
        "Speed",
        "Time of day",
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
