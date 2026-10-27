import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BarChart } from "../src/charts/BarChart";
import { ChartTable } from "../src/charts/ChartTable";
import type { ChartRow, ChartSeries } from "../src/charts/chartTypes";
import { HeatGrid } from "../src/charts/HeatGrid";
import { Histogram } from "../src/charts/Histogram";
import { Legend } from "../src/charts/Legend";
import { LineChart } from "../src/charts/LineChart";
import { StatTile } from "../src/charts/StatTile";
import { StatTiles } from "../src/charts/StatTiles";
import { describeBars } from "../src/charts/summaries";

const km = (metres: number) => `${Number((metres / 1000).toFixed(1))} km`;

const series: ChartSeries[] = [
  { key: "car", label: "Car", tone: "car" },
  { key: "train", label: "Train", tone: "train" },
];

const days: ChartRow[] = [
  { key: "2026-10-26", label: "Monday 26 October", tick: "Mon 26", values: [12_300, 30_000] },
  { key: "2026-10-27", label: "Tuesday 27 October", tick: "Tue 27", values: [0, 5_000] },
  { key: "2026-10-28", label: "Wednesday 28 October", tick: "Wed 28", values: [2_000, 0] },
];

const summary = "Highest: Monday 26 October, 42.3 km. Total 49.3 km.";

/** The one tooltip of a chart; hidden from assistive technology, so found by its class. */
const tooltipOf = (figure: HTMLElement) => figure.querySelector<HTMLElement>(".chart-tooltip");

/** The marks that are in the tab order. */
const tabStops = (figure: HTMLElement) =>
  within(figure)
    .getAllByRole("img")
    .filter((mark) => mark.getAttribute("tabindex") === "0");

/** A box that lays out at `width` px (jsdom lays nothing out). */
function laidOutAt(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly #callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.#callback = callback;
      }
      observe(target: Element): void {
        const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry;
        this.#callback([entry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

describe("BarChart", () => {
  it("is a figure named by its title and described by its summary", () => {
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    expect(figure).toHaveAccessibleDescription(summary);
    expect(within(figure).getByRole("group", { name: "Distance per day" })).toBeInTheDocument();
  });

  it("makes every row a mark named by its label and described by its values and total", () => {
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    expect(within(figure).getAllByRole("img")).toHaveLength(3);
    expect(
      within(figure).getByRole("img", { name: "Monday 26 October" }),
    ).toHaveAccessibleDescription("Car 12.3 km, Train 30 km, total 42.3 km");
    expect(
      within(figure).getByRole("img", { name: "Tuesday 27 October" }),
    ).toHaveAccessibleDescription("Train 5 km, total 5 km");
  });

  it("is one tab stop that the arrow keys, Home and End move along", async () => {
    const user = userEvent.setup();
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    const [monday, tuesday, wednesday] = within(figure).getAllByRole("img");
    expect(tabStops(figure)).toEqual([monday]);

    await user.tab();
    expect(monday).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tuesday).toHaveFocus();
    expect(tabStops(figure)).toEqual([tuesday]);
    await user.keyboard("{End}");
    expect(wednesday).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(wednesday).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tuesday).toHaveFocus();
    await user.keyboard("{Home}");
    expect(monday).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(monday).toHaveFocus();

    // Leaving and coming back lands on the mark last visited.
    await user.keyboard("{End}");
    await user.tab({ shift: true });
    expect(wednesday).not.toHaveFocus();
    await user.tab();
    expect(wednesday).toHaveFocus();
  });

  it("shows the tooltip with every series and the total on focus, and hides it on Escape", async () => {
    const user = userEvent.setup();
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    expect(tooltipOf(figure)).toBeNull();

    await user.tab();
    const tooltip = tooltipOf(figure);
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
    expect(tooltip).toHaveTextContent("Monday 26 October12.3 kmCar30 kmTrain42.3 kmTotal");
    expect(figure.querySelector(".chart__focus-ring")).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(tooltipOf(figure)).toBeNull();
    expect(within(figure).getByRole("img", { name: "Monday 26 October" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(tooltipOf(figure)).toHaveTextContent("Tuesday 27 October5 kmTrain5 kmTotal");
  });

  it("shows the tooltip for the mark under the pointer, and hides it when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    const wednesday = within(figure).getByRole("img", { name: "Wednesday 28 October" });

    await user.hover(wednesday);
    expect(tooltipOf(figure)).toHaveTextContent("Wednesday 28 October2 kmCar2 kmTotal");
    await user.unhover(wednesday);
    expect(tooltipOf(figure)).toBeNull();
  });

  it("shows the tooltip on a tap, not while a finger passes over on its way to scrolling", () => {
    render(
      <>
        <BarChart
          title="Distance per day"
          summary={summary}
          series={series}
          rows={days}
          formatValue={km}
        />
        <p>Elsewhere</p>
      </>,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    const tuesday = within(figure).getByRole("img", { name: "Tuesday 27 October" });
    const plot = tuesday.closest(".chart__plot") ?? tuesday;

    fireEvent.pointerEnter(tuesday, { pointerType: "touch" });
    fireEvent.pointerMove(tuesday, { pointerType: "touch" });
    expect(tooltipOf(figure)).toBeNull();

    // Some phones do not move focus on a tap: the tap alone shows the tooltip.
    fireEvent.click(tuesday);
    expect(tuesday).not.toHaveFocus();
    expect(tooltipOf(figure)).toHaveTextContent("Tuesday 27 October5 kmTrain5 kmTotal");
    // The finger lifting off the screen leaves the plot, yet the tooltip stays.
    fireEvent.pointerLeave(plot, { pointerType: "touch" });
    expect(tooltipOf(figure)).not.toBeNull();
    // A press on another mark of the chart moves the tooltip there rather than hiding it.
    fireEvent.pointerDown(within(figure).getByRole("img", { name: "Monday 26 October" }));
    expect(tooltipOf(figure)).not.toBeNull();
    // A press anywhere else hides it, focus or not.
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(tooltipOf(figure)).toBeNull();
  });

  it("shows the tooltip on a tap that focuses the mark, and hides it on a tap elsewhere", async () => {
    const user = userEvent.setup();
    render(
      <>
        <BarChart
          title="Distance per day"
          summary={summary}
          series={series}
          rows={days}
          formatValue={km}
        />
        <p>Elsewhere</p>
      </>,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    const tuesday = within(figure).getByRole("img", { name: "Tuesday 27 October" });
    await user.pointer({ keys: "[TouchA]", target: tuesday });
    expect(tooltipOf(figure)).toHaveTextContent("Tuesday 27 October");
    await user.pointer({ keys: "[TouchA]", target: screen.getByText("Elsewhere") });
    expect(tooltipOf(figure)).toBeNull();
  });

  it("has a legend of its series and the numbers in a table", async () => {
    const user = userEvent.setup();
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
        categoryLabel="Day"
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    const legend = within(figure).getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Car", "Train"]);

    await user.click(within(figure).getByText("Show the numbers"));
    const table = within(figure).getByRole("table", { name: "Distance per day" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Day", "Car", "Train", "Total"]);
    const monday = within(table).getByRole("row", { name: /Monday 26 October/ });
    expect(within(monday).getByRole("rowheader")).toHaveTextContent("Monday 26 October");
    expect(
      within(monday)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["12.3 km", "30 km", "42.3 km"]);
    expect(within(figure).getByRole("region", { name: "Distance per day" })).toContainElement(
      table,
    );
  });

  it("has no legend, total or keys for a single series", async () => {
    const user = userEvent.setup();
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series.slice(0, 1)}
        rows={days}
        formatValue={km}
        tableLabel="Distances"
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    expect(within(figure).queryByRole("list")).toBeNull();
    expect(
      within(figure).getByRole("img", { name: "Monday 26 October" }),
    ).toHaveAccessibleDescription("12.3 km");
    await user.tab();
    expect(tooltipOf(figure)).toHaveTextContent("Monday 26 October12.3 km");
    expect(figure.querySelector(".chart-tooltip__key")).toBeNull();
    await user.click(within(figure).getByText("Distances"));
    expect(within(figure).queryByRole("columnheader", { name: "Total" })).toBeNull();
  });

  it("lists every series of a grouped row, without a total", () => {
    render(
      <BarChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        layout="grouped"
        formatValue={km}
      />,
    );
    expect(screen.getByRole("img", { name: "Tuesday 27 October" })).toHaveAccessibleDescription(
      "Car 0 km, Train 5 km",
    );
  });

  it("keeps every bar of a group inside its row's band, however narrow", () => {
    laidOutAt(300);
    const four = ["walking", "cycling", "car", "train"].map((mode) => ({
      key: mode,
      label: mode,
      tone: mode as "walking" | "cycling" | "car" | "train",
    }));
    const hours: ChartRow[] = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `Hour ${hour}`,
      values: [1000 + hour, 2000, 3000, 4000],
    }));
    const { container } = render(
      <BarChart
        title="By hour and mode"
        summary="Busy."
        series={four}
        rows={hours}
        layout="grouped"
        formatValue={km}
      />,
    );
    const targets = [...container.querySelectorAll("svg.chart__target")].map((target) => ({
      left: Number(target.getAttribute("x")),
      right: Number(target.getAttribute("x")) + Number(target.getAttribute("width")),
    }));
    expect(targets).toHaveLength(24);
    const groups = [...container.querySelectorAll('svg.chart__layer > g[class^="mode-color-"]')];
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      const paths = [...group.querySelectorAll("path")];
      expect(paths).toHaveLength(24);
      for (const [hour, path] of paths.entries()) {
        const edges = /^M([\d.]+) .*A[\d.]+ [\d.]+ 0 0 1 ([\d.]+) [\d.]+V[\d.]+Z$/.exec(
          path.getAttribute("d") ?? "",
        );
        const band = targets[hour];
        expect(edges).not.toBeNull();
        expect(Number(edges?.[1])).toBeGreaterThanOrEqual((band?.left ?? 0) - 0.01);
        expect(Number(edges?.[2])).toBeLessThanOrEqual((band?.right ?? 0) + 0.01);
      }
    }
  });

  it("draws horizontal bars with their values at the ends and long names cut short", () => {
    const roads: ChartRow[] = [
      { key: "residential", label: "Residential streets and service roads", values: [8_200] },
      { key: "motorway", label: "Motorway", values: [41_000] },
    ];
    const { container } = render(
      <BarChart
        title="Distance by road"
        summary="Mostly on the motorway."
        series={[{ key: "distance", label: "Distance", tone: "accent" }]}
        rows={roads}
        orientation="horizontal"
        valueLabels
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance by road" });
    expect(within(figure).getByText("41 km", { selector: "text" })).toBeInTheDocument();
    expect(within(figure).getByText("8.2 km", { selector: "text" })).toBeInTheDocument();
    const labels = [...container.querySelectorAll("text.chart__label")].map(
      (label) => label.textContent,
    );
    expect(labels[1]).toBe("Motorway");
    expect(labels[0]).toMatch(/^Residential .*…$/);
    expect(
      within(figure).getByRole("img", { name: "Residential streets and service roads" }),
    ).toHaveAccessibleDescription("8.2 km");
  });

  it("puts the totals on the columns only where every one of them fits", () => {
    const totalsOn = (width: number) => {
      laidOutAt(width);
      const { container, unmount } = render(
        <BarChart
          title="Distance per day"
          summary={summary}
          series={series}
          rows={days}
          formatValue={km}
          valueLabels
        />,
      );
      const values = [...container.querySelectorAll("text.chart__value")].map(
        (value) => value.textContent,
      );
      unmount();
      return values;
    };
    expect(totalsOn(640)).toEqual(["42.3 km", "5 km", "2 km"]);
    expect(totalsOn(120)).toEqual([]);
  });

  it("thins the hours of a day to what fits: every third on a phone, every one on a wide screen", () => {
    const hours: ChartRow[] = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`,
      tick: String(hour).padStart(2, "0"),
      values: [hour % 5 === 0 ? 0 : hour * 100],
    }));
    const hourTicks = (width: number) => {
      laidOutAt(width);
      const { container, unmount } = render(
        <BarChart
          title="By time of day"
          summary="Busiest in the evening."
          series={[{ key: "distance", label: "Distance", tone: "cycling" }]}
          rows={hours}
          formatValue={km}
        />,
      );
      expect(container.querySelector("svg.chart__svg")).toHaveAttribute(
        "viewBox",
        `0 0 ${width} 240`,
      );
      const ticks = [...container.querySelectorAll("text.chart__tick")]
        .map((tick) => tick.textContent ?? "")
        .filter((text) => /^\d\d$/.test(text));
      unmount();
      return ticks;
    };
    // A 320 px phone leaves the chart 288 px (inside a card, 248 px).
    const everyThird = ["00", "03", "06", "09", "12", "15", "18", "21"];
    expect(hourTicks(288)).toEqual(everyThird);
    expect(hourTicks(248)).toEqual(everyThird);
    expect(hourTicks(900)).toHaveLength(24);
  });

  it("says there is nothing to show instead of drawing zeros or nothing", () => {
    const zeros = days.map((row) => ({ ...row, values: [0, 0] }));
    const { container, rerender } = render(
      <BarChart
        title="Distance per day"
        summary="No moves."
        series={series}
        rows={zeros}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    expect(within(figure).getByText("Nothing to show for this period.")).toBeInTheDocument();
    expect(within(figure).queryByRole("img")).toBeNull();
    expect(container.innerHTML).not.toContain("NaN");

    // A summary that already says so is not followed by the same sentence.
    rerender(
      <BarChart
        title="Distance per day"
        summary={describeBars(zeros, series, km)}
        series={series}
        rows={zeros}
        formatValue={km}
      />,
    );
    expect(screen.getAllByText("Nothing to show for this period.")).toHaveLength(1);
    expect(screen.getByRole("figure", { name: "Distance per day" })).toHaveAccessibleDescription(
      "Nothing to show for this period.",
    );

    rerender(
      <BarChart
        title="Distance per day"
        summary="No moves."
        series={series}
        rows={[{ key: "x", label: "X", values: [Number.NaN, -4] }]}
        orientation="horizontal"
        valueLabels
        formatValue={km}
      />,
    );
    expect(screen.getByText("Nothing to show for this period.")).toBeInTheDocument();
    rerender(
      <BarChart
        title="Distance per day"
        summary="No moves."
        series={series}
        rows={[]}
        formatValue={km}
      />,
    );
    expect(screen.getByText("Nothing to show for this period.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("LineChart", () => {
  it("makes every x position a mark described by every series there", () => {
    render(
      <LineChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    expect(figure).toHaveAccessibleDescription(summary);
    expect(within(figure).getAllByRole("img")).toHaveLength(3);
    expect(
      within(figure).getByRole("img", { name: "Tuesday 27 October" }),
    ).toHaveAccessibleDescription("Car 0 km, Train 5 km");
    const legend = within(figure).getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(2);
    expect(legend.querySelector("line.legend__line")).not.toBeNull();
  });

  it("snaps the crosshair and the one tooltip to the mark under the pointer", async () => {
    const user = userEvent.setup();
    render(
      <LineChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    expect(figure.querySelector(".line-chart__crosshair")).toBeNull();
    await user.hover(within(figure).getByRole("img", { name: "Wednesday 28 October" }));
    expect(figure.querySelector(".line-chart__crosshair")).not.toBeNull();
    expect(tooltipOf(figure)).toHaveTextContent("Wednesday 28 October2 kmCar0 kmTrain");
    expect(figure.querySelectorAll(".chart-tooltip")).toHaveLength(1);
  });

  it("moves along the rows with the keyboard and hides the tooltip on Escape", async () => {
    const user = userEvent.setup();
    render(
      <LineChart
        title="Distance per day"
        summary={summary}
        series={series}
        rows={days}
        formatValue={km}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Distance per day" });
    const marks = within(figure).getAllByRole("img");
    expect(tabStops(figure)).toHaveLength(1);
    await user.tab();
    expect(marks[0]).toHaveFocus();
    expect(tooltipOf(figure)).toHaveTextContent("Monday 26 October");
    await user.keyboard("{End}");
    expect(marks[2]).toHaveFocus();
    expect(tooltipOf(figure)).toHaveTextContent("Wednesday 28 October");
    await user.keyboard("{Escape}");
    expect(tooltipOf(figure)).toBeNull();
  });

  it("dots every point of a short line, washes the area under a single one, and has the table", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LineChart
        title="Distance per day"
        summary={summary}
        series={series.slice(0, 1)}
        rows={days}
        formatValue={km}
        area
      />,
    );
    expect(container.querySelectorAll(".line-chart__marker")).toHaveLength(3);
    expect(container.querySelector(".line-chart__area")).not.toBeNull();
    await user.click(screen.getByText("Show the numbers"));
    const table = screen.getByRole("table", { name: "Distance per day" });
    expect(within(table).getByRole("row", { name: /Wednesday 28 October/ })).toHaveTextContent(
      "2 km",
    );
  });

  it("says there is nothing to show for an empty period", () => {
    const { container } = render(
      <LineChart
        title="Distance per day"
        summary="No moves."
        series={series}
        rows={[]}
        formatValue={km}
      />,
    );
    expect(screen.getByText("Nothing to show for this period.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("Histogram", () => {
  const bins = [
    { from: 0, to: 10, count: 2 },
    { from: 10, to: 20, count: 5 },
    { from: 20, to: 30, count: 1 },
  ];
  const histogram = (counts = bins) => (
    <Histogram
      title="Speed"
      summary="Most rides at 10–20 km/h."
      bins={counts}
      tone="cycling"
      formatEdge={(edge) => String(edge)}
      formatBin={(from, to) => `${from}–${to} km/h`}
      formatCount={(count) => `${count} ${count === 1 ? "ride" : "rides"}`}
      xLabel="Median speed, km/h"
      countLabel="Rides"
    />
  );

  it("makes every bin a mark named by its range and described by its count", async () => {
    const user = userEvent.setup();
    render(histogram());
    const figure = screen.getByRole("figure", { name: "Speed" });
    expect(figure).toHaveAccessibleDescription("Most rides at 10–20 km/h.");
    expect(within(figure).getByRole("img", { name: "10–20 km/h" })).toHaveAccessibleDescription(
      "5 rides",
    );
    expect(within(figure).getByText("Median speed, km/h", { selector: "p" })).toBeInTheDocument();
    expect(tabStops(figure)).toEqual([within(figure).getByRole("img", { name: "0–10 km/h" })]);

    await user.tab();
    expect(tooltipOf(figure)).toHaveTextContent("0–10 km/h2 rides");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(within(figure).getByRole("img", { name: "20–30 km/h" })).toHaveFocus();
    expect(tooltipOf(figure)).toHaveTextContent("20–30 km/h1 ride");
  });

  it("labels the bin edges and has the bins in a table", async () => {
    const user = userEvent.setup();
    const { container } = render(histogram());
    const edges = [...container.querySelectorAll("text.chart__tick")].map(
      (tick) => tick.textContent,
    );
    expect(edges).toEqual(expect.arrayContaining(["0", "10", "20", "30"]));
    await user.click(screen.getByText("Show the numbers"));
    const table = screen.getByRole("table", { name: "Speed" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Median speed, km/h", "Rides"]);
    expect(within(table).getByRole("row", { name: /10–20 km\/h/ })).toHaveTextContent("5 rides");
  });

  it("says there is nothing to show without counts", () => {
    const { container } = render(histogram(bins.map((bin) => ({ ...bin, count: 0 }))));
    expect(screen.getByText("Nothing to show for this period.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("HeatGrid", () => {
  const weekdays = [
    { key: "mon", label: "Monday", tick: "Mon" },
    { key: "tue", label: "Tuesday", tick: "Tue" },
  ];
  const hours = [
    { key: "7", label: "07:00–08:00", tick: "07" },
    { key: "8", label: "08:00–09:00", tick: "08" },
    { key: "9", label: "09:00–10:00", tick: "09" },
  ];
  const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;
  const grid = (values: number[][]) => (
    <HeatGrid
      title="When you travel"
      summary="Mostly on Monday mornings."
      rows={weekdays}
      columns={hours}
      values={values}
      cellLabel={(row, column) => `${row.label}, ${column.label}`}
      formatValue={minutes}
      categoryLabel="Day"
    />
  );

  it("makes every cell a mark named by its row and column and described by its value", () => {
    render(
      grid([
        [600, 3000, 0],
        [0, 1200, 300],
      ]),
    );
    const figure = screen.getByRole("figure", { name: "When you travel" });
    expect(figure).toHaveAccessibleDescription("Mostly on Monday mornings.");
    expect(within(figure).getAllByRole("img")).toHaveLength(6);
    expect(
      within(figure).getByRole("img", { name: "Monday, 08:00–09:00" }),
    ).toHaveAccessibleDescription("50 min");
    expect(
      within(figure).getByRole("img", { name: "Monday, 09:00–10:00" }),
    ).toHaveAccessibleDescription("0 min");
    expect(tabStops(figure)).toHaveLength(1);
  });

  it("moves along a row with Left and Right, between rows with Up and Down", async () => {
    const user = userEvent.setup();
    render(
      grid([
        [600, 3000, 0],
        [0, 1200, 300],
      ]),
    );
    const figure = screen.getByRole("figure", { name: "When you travel" });
    const cell = (name: string) => within(figure).getByRole("img", { name });
    await user.tab();
    expect(cell("Monday, 07:00–08:00")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(cell("Monday, 08:00–09:00")).toHaveFocus();
    expect(tooltipOf(figure)).toHaveTextContent("Monday, 08:00–09:0050 min");
    await user.keyboard("{ArrowDown}");
    expect(cell("Tuesday, 08:00–09:00")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(cell("Tuesday, 08:00–09:00")).toHaveFocus();
    await user.keyboard("{End}");
    expect(cell("Tuesday, 09:00–10:00")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(cell("Tuesday, 09:00–10:00")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(cell("Tuesday, 07:00–08:00")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(cell("Monday, 07:00–08:00")).toHaveFocus();
    await user.keyboard("{Control>}{End}{/Control}");
    expect(cell("Tuesday, 09:00–10:00")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(tooltipOf(figure)).toBeNull();
  });

  it("shades cells in equal bins with a scale legend, and keeps empty cells apart", async () => {
    const user = userEvent.setup();
    const { container } = render(
      grid([
        [600, 3000, 0],
        [0, 1200, 300],
      ]),
    );
    const shades = [...container.querySelectorAll("rect.heat-grid__cell")]
      .filter((cell) => cell.closest(".heat-legend") === null)
      .map((cell) => cell.getAttribute("class")?.replace("heat-grid__cell heat-grid__cell--", ""));
    expect(shades).toEqual(["1", "5", "0", "0", "2", "1"]);
    const scale = screen.getByRole("list", { name: "Colour scale" });
    expect(
      within(scale)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "None",
      "Up to 10 min",
      "10 min–20 min",
      "20 min–30 min",
      "30 min–40 min",
      "40 min–50 min",
    ]);
    await user.click(screen.getByText("Show the numbers"));
    const table = screen.getByRole("table", { name: "When you travel" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Day", "07:00–08:00", "08:00–09:00", "09:00–10:00"]);
    expect(within(table).getByRole("row", { name: /Tuesday/ })).toHaveTextContent(
      "Tuesday0 min20 min5 min",
    );
  });

  it("keeps the scale legible when the formatter rounds: no empty or repeated ranges", () => {
    render(
      grid([
        [30, 120, 0],
        [45, 0, 0],
      ]),
    );
    const scale = screen.getByRole("list", { name: "Colour scale" });
    expect(
      within(scale)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["None", "Up to 1 min", "1 min–2 min"]);
  });

  it("fits a day's 24 hours on a phone: cells shrink and the hour labels thin out", () => {
    laidOutAt(288);
    const day = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      tick: String(hour).padStart(2, "0"),
    }));
    const { container } = render(
      <HeatGrid
        title="When you travel"
        summary="Mostly in the morning."
        rows={weekdays}
        columns={day}
        values={[day.map((_, hour) => hour * 10), day.map(() => 0)]}
        cellLabel={(row, column) => `${row.label}, ${column.label}`}
        formatValue={minutes}
      />,
    );
    const cell = container.querySelector("rect.heat-grid__cell");
    expect(Number(cell?.getAttribute("width"))).toBeGreaterThan(8);
    expect(Number(cell?.getAttribute("width"))).toBeLessThan(12);
    const hourTicks = [...container.querySelectorAll("text.chart__tick")]
      .map((tick) => tick.textContent ?? "")
      .filter((text) => /^\d\d$/.test(text));
    expect(hourTicks).toEqual(["00", "03", "06", "09", "12", "15", "18", "21"]);
  });

  it("says there is nothing to show for an empty grid", () => {
    const { container } = render(
      grid([
        [0, 0, 0],
        [0, 0, 0],
      ]),
    );
    expect(screen.getByText("Nothing to show for this period.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("Legend", () => {
  it("lists its items with a box or a line beside each name", () => {
    const { container, rerender } = render(<Legend items={series} shape="bar" label="Modes" />);
    const list = screen.getByRole("list", { name: "Modes" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Car", "Train"]);
    expect(container.querySelectorAll("rect.legend__swatch")).toHaveLength(2);
    rerender(<Legend items={series} shape="line" />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(container.querySelectorAll("line.legend__line")).toHaveLength(2);
  });
});

describe("ChartTable", () => {
  it("puts the numbers in a disclosure with row headers and numeric columns", async () => {
    const user = userEvent.setup();
    render(
      <ChartTable
        label="Show the numbers"
        caption="Distance per mode"
        columns={[
          { key: "mode", label: "Mode" },
          { key: "distance", label: "Distance", numeric: true },
        ]}
        rows={[{ key: "car", cells: ["Car", "12.3 km"] }]}
      />,
    );
    const disclosure = screen.getByText("Show the numbers").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    await user.click(screen.getByText("Show the numbers"));
    expect(disclosure).toHaveAttribute("open");
    const table = screen.getByRole("table", { name: "Distance per mode" });
    expect(within(table).getByRole("rowheader", { name: "Car" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "12.3 km" })).toHaveClass("table__number");
    expect(within(table).getByRole("columnheader", { name: "Distance" })).toHaveClass(
      "table__number",
    );
  });
});

describe("StatTiles", () => {
  it("is a list of terms and values with a detail and a delta in words", () => {
    render(
      <StatTiles label="This month">
        <StatTile
          label="Distance"
          value="412 km"
          detail="in 38 moves"
          delta={{ text: "12% more than the month before", direction: "up" }}
          icon="route"
        />
        <StatTile label="Active days" value="21" delta={null} />
      </StatTiles>,
    );
    const group = screen.getByRole("group", { name: "This month" });
    const list = group.querySelector("dl");
    expect(list).not.toBeNull();
    const [distance, days] = within(group).getAllByRole("term");
    expect(distance).toHaveTextContent("Distance");
    expect(days).toHaveTextContent("Active days");
    expect(distance?.parentElement?.tagName).toBe("DIV");
    expect(distance?.parentElement?.parentElement).toBe(list);
    const values = within(group)
      .getAllByRole("definition")
      .map((value) => value.textContent);
    expect(values).toEqual(["412 km", "in 38 moves", "12% more than the month before", "21"]);
  });

  it("needs no name when a heading already says what the tiles are", () => {
    const { container } = render(
      <StatTiles>
        <StatTile label="Moves" value="38" />
      </StatTiles>,
    );
    expect(screen.queryByRole("group")).toBeNull();
    expect(container.querySelector("dl dt")).toHaveTextContent("Moves");
    expect(container.querySelector("dl dd")).toHaveTextContent("38");
  });
});
