import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { openGroup } from "./support/openGroup";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const today = new Date().toISOString().slice(0, 10);

/** The heatmap route answering as the measure asked for. */
function heatRoutes(
  answer: (heat: string, url: URL) => Record<string, unknown> | null = () => null,
) {
  return {
    ...standardRoutes(),
    "GET /api/heatmap": ({ url }: { url: URL }) => {
      const heat = url.searchParams.get("heat") ?? "points";
      const custom = answer(heat, url);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      return {
        status: 200,
        body:
          custom ??
          (heat === "points"
            ? {
                heat,
                cellZoom: 15,
                cells: [
                  [16705, 10972, 9000],
                  [16722, 10963, 40],
                ],
                truncated: false,
                period: null,
                pending: false,
              }
            : {
                heat,
                cellZoom: 15,
                cells: [
                  [16705, 10972, 12_000],
                  [16722, 10963, 300],
                ],
                truncated: false,
                period: { from: from ?? "2025-11-01", to: to ?? today },
                pending: false,
              }),
      };
    },
  };
}

const openOptions = async (person: ReturnType<typeof userEvent.setup>) => {
  await person.click(screen.getByRole("button", { name: /Map options/ }));
};

describe("Heat's options", () => {
  it("offers a period only for the measures that have one", async () => {
    mockApi(heatRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: "/?view=heat&person=me", user });
    await openOptions(person);
    const heatBy = await screen.findByRole("combobox", { name: "Heat by" });
    expect(heatBy).toHaveValue("points");
    expect(
      within(heatBy)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Points recorded", "Time spent at places", "Visits to places"]);
    expect(screen.queryByRole("combobox", { name: "Period" })).not.toBeInTheDocument();
    await person.selectOptions(heatBy, "time");
    const period = await screen.findByRole("combobox", { name: "Period" });
    expect(period).toHaveValue("all");
    expect(router.state.location.search).toContain("heat=time");
    await person.selectOptions(screen.getByRole("combobox", { name: "Heat by" }), "points");
    expect(screen.queryByRole("combobox", { name: "Period" })).not.toBeInTheDocument();
  });

  it("asks for a preset period, and shows the one the address names", async () => {
    const { calls } = mockApi(heatRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me&heat=visits", user });
    await openOptions(person);
    await person.selectOptions(await screen.findByRole("combobox", { name: "Period" }), "7d");
    await waitFor(() =>
      expect(
        calls.some((call) => call.url?.includes("heat=visits") && call.url.includes("from=")),
      ).toBe(true),
    );
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveValue("7d");
  });

  it("takes a custom period with its form, and says what is wrong with one", async () => {
    mockApi(heatRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&heat=time",
      user,
    });
    await openOptions(person);
    await person.selectOptions(await screen.findByRole("combobox", { name: "Period" }), "custom");
    const from = await screen.findByLabelText("From");
    const to = screen.getByLabelText("To");
    await person.clear(from);
    await person.type(from, "2026-10-20");
    await person.clear(to);
    await person.type(to, "2026-10-10");
    await person.click(screen.getByRole("button", { name: "Show period" }));
    expect(await screen.findByText("From must not be after To.")).toBeInTheDocument();
    await person.clear(from);
    await person.type(from, "2020-01-01");
    await person.clear(to);
    await person.type(to, "2026-10-10");
    await person.click(screen.getByRole("button", { name: "Show period" }));
    expect(await screen.findByText("A period can span at most 3 years.")).toBeInTheDocument();
    await person.clear(from);
    await person.type(from, "2026-10-03");
    await person.click(screen.getByRole("button", { name: "Show period" }));
    await waitFor(() => expect(router.state.location.search).toContain("from=2026-10-03"));
    expect(router.state.location.search).toContain("to=2026-10-10");
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveValue("custom");
    expect(
      within(screen.getByRole("combobox", { name: "Period" })).getByRole("option", {
        name: /^Custom: 3 Oct – 10 Oct/,
      }),
    ).toBeInTheDocument();
  });
});

describe("the custom period's form", () => {
  it("shows the dates of the address when it opens, and marks both ends when they disagree", async () => {
    // The clock stands at 14:00 on the account's today, whatever the hour the suite runs at.
    const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone }).format(
      new Date(),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(`${localToday}T12:00:00Z`) });
    try {
      await customPeriodForm(localToday);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function customPeriodForm(today: string) {
  {
    mockApi(heatRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&heat=time&from=2026-10-03&to=2026-10-10",
      user,
    });
    await openOptions(person);
    expect(await screen.findByLabelText("From")).toHaveValue("2026-10-03");
    // A preset replaces the dates; the form, shown again, has the preset's.
    await person.selectOptions(screen.getByRole("combobox", { name: "Period" }), "7d");
    await person.selectOptions(screen.getByRole("combobox", { name: "Period" }), "custom");
    expect(await screen.findByLabelText("To")).toHaveValue(today);
    await person.clear(screen.getByLabelText("From"));
    await person.type(screen.getByLabelText("From"), "2026-10-20");
    await person.clear(screen.getByLabelText("To"));
    await person.type(screen.getByLabelText("To"), "2026-10-10");
    await person.click(screen.getByRole("button", { name: "Show period" }));
    expect(await screen.findByText("From must not be after To.")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toBeInvalid();
    expect(screen.getByLabelText("To")).toBeInvalid();
  }
}

describe("Heat's key", () => {
  const keyList = (name: string) => screen.findByRole("list", { name });

  it("is titled for the measure, with its period and its classes in words", async () => {
    mockApi(heatRoutes());
    renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&heat=time&from=2026-10-01&to=2026-10-31",
      user,
    });
    const list = await keyList("Time spent at places in each square");
    const items = within(list)
      .getAllByRole("listitem")
      .filter((item) => item.textContent !== "");
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/hr|min|day/)]),
    );
    expect(items.at(-1)).toHaveTextContent(/or more$/);
    const key = list.closest("section");
    expect(key).toHaveAccessibleName("Time spent at places in each square");
    expect(within(key as HTMLElement).getByText("1–31 Oct 2026")).toBeInTheDocument();
    // The map is described by it.
    expect(screen.getByRole("img", { name: /^Heatmap of time spent at places/ })).toHaveAttribute(
      "aria-describedby",
      key?.id,
    );
  });

  it("says since when for all time, and counts visits in its own title", async () => {
    mockApi(heatRoutes());
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me&heat=visits", user });
    const list = await keyList("Visits to places in each square");
    expect(within(list.closest("section") as HTMLElement).getByText(/^Since /)).toBeInTheDocument();
  });

  it("says when nothing is in view, when days are still worked out and when the view was cut", async () => {
    mockApi(
      heatRoutes((heat) => ({
        heat,
        cellZoom: 15,
        cells: [],
        truncated: false,
        period: { from: "2026-10-01", to: "2026-10-31" },
        pending: true,
      })),
    );
    renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&heat=time&from=2026-10-01&to=2026-10-31",
      user,
    });
    expect(await screen.findByText("Nothing in view for this period")).toBeInTheDocument();
    expect(screen.getByText("Recent days are still being worked out")).toBeInTheDocument();
  });

  it("says when only the busiest places are drawn", async () => {
    mockApi(
      heatRoutes((heat) => ({
        heat,
        cellZoom: 15,
        cells: [[16705, 10972, 90]],
        truncated: true,
        period: null,
        pending: false,
      })),
    );
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me", user });
    expect(
      await screen.findByText("Busiest places only: zoom in to see every place"),
    ).toBeInTheDocument();
  });

  it("offers to try again when the heatmap could not be loaded", async () => {
    let fail = true;
    mockApi({
      ...heatRoutes(),
      "GET /api/heatmap": ({ url }: { url: URL }) =>
        fail
          ? { status: 500, body: { error: { code: "internal", message: "Broken" } } }
          : {
              status: 200,
              body: {
                heat: url.searchParams.get("heat") ?? "points",
                cellZoom: 15,
                cells: [[16705, 10972, 9]],
                truncated: false,
                period: null,
                pending: false,
              },
            },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me", user });
    expect(await screen.findByText("The heatmap could not be loaded")).toBeInTheDocument();
    fail = false;
    await person.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByText("The heatmap could not be loaded")).not.toBeInTheDocument(),
    );
  });

  it("shows the busiest places in the measure's words", async () => {
    mockApi(heatRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me&heat=time", user });
    await openGroup(person, "Heat: totals, busiest places");
    const busiest = await screen.findByRole("region", { name: "Busiest places in view" });
    const items = await within(busiest).findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("3 hrs 20 mins");
    expect(items[1]).toHaveTextContent("5 mins");
  });
});

describe("the lens chip", () => {
  it("names the period that filters the answer and takes it off with a step of the history", async () => {
    mockApi(heatRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: `/?view=heat&person=me&heat=time&from=2026-10-01&to=2026-10-31&devices=${ids.phone}`,
      user,
    });
    expect(await screen.findByText("October 2026")).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Show all time" }));
    await waitFor(() => expect(screen.queryByText("October 2026")).not.toBeInTheDocument());
    const search = new URLSearchParams(router.state.location.search);
    expect(search.has("heat")).toBe(false);
    expect(search.has("from")).toBe(false);
    expect(search.get("devices")).toBe(ids.phone);
    expect(router.state.historyAction).toBe("REPLACE");
    // The chip is gone: focus is on the map options, not lost.
    expect(screen.getByRole("button", { name: /Map options/ })).toHaveFocus();
  });

  it("says a year, or a range, and is not there without a period", async () => {
    mockApi(heatRoutes());
    const first = renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&heat=visits&from=2025-01-01&to=2025-12-31",
      user,
    });
    expect(await screen.findByText("2025")).toBeInTheDocument();
    first.unmount();
    const second = renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&heat=visits&from=2026-10-01&to=2026-10-15",
      user,
    });
    expect(await screen.findByText(/^1 Oct – 15 Oct 2026$/)).toBeInTheDocument();
    second.unmount();
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me&heat=visits", user });
    await screen.findByRole("list", { name: "Visits to places in each square" });
    expect(screen.queryByRole("button", { name: "Show all time" })).not.toBeInTheDocument();
  });
});
