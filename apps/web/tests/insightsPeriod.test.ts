import { describe, expect, it } from "vitest";
import { createFormatter } from "../src/format/createFormatter";
import { insightsLink } from "../src/pages/insights/insightsLinks";
import {
  comparisonName,
  comparisonOf,
  daysBefore,
  type InsightsPeriod,
  insightsParams,
  isInsightsRange,
  parseInsightsAddress,
  periodInUnit,
  periodLabel,
  periodRange,
  stepPeriod,
  withDevices,
  withPeriod,
} from "../src/pages/insights/insightsPeriod";

const format = createFormatter("en-GB", "Europe/Brussels");
// A Wednesday, in the middle of a month, a week and a year.
const today = "2026-11-04";
const device = "01926f3c-2e5f-7a71-8243-5d6e7f8091a1";
const address = (query: string, on = today) => parseInsightsAddress(new URLSearchParams(query), on);
const period = (query: string, on = today): InsightsPeriod => address(query, on).period;

describe("reading the address of Insights", () => {
  it("takes this month when it says nothing, or says something it cannot read", () => {
    const month = { kind: "month", first: "2026-11-01", last: "2026-11-30", current: true };
    expect(period("")).toEqual(month);
    expect(period("period=fortnight")).toEqual(month);
    expect(period("period=2026-13")).toEqual(month);
    expect(period("period=2026-W00")).toEqual(month);
    expect(period("period=constructor")).toEqual(month);
    // The future has nothing to show.
    expect(period("period=2027-01")).toEqual(month);
    expect(period("period=2027")).toEqual(month);
    expect(period("period=2026-W50")).toEqual(month);
    expect(period("period=1969")).toEqual(month);
  });

  it("reads the current week, month, year and all of it", () => {
    expect(period("period=week")).toEqual({
      kind: "week",
      first: "2026-11-02",
      last: "2026-11-08",
      current: true,
    });
    expect(period("period=month")).toEqual(period(""));
    expect(period("period=year")).toEqual({
      kind: "year",
      first: "2026-01-01",
      last: "2026-12-31",
      current: true,
    });
    expect(period("period=all")).toEqual({ kind: "all" });
  });

  it("reads fixed weeks (Monday first), months and years", () => {
    expect(period("period=2026-W44")).toEqual({
      kind: "week",
      first: "2026-10-26",
      last: "2026-11-01",
      current: false,
    });
    expect(period("period=2026-10")).toEqual({
      kind: "month",
      first: "2026-10-01",
      last: "2026-10-31",
      current: false,
    });
    expect(period("period=2025")).toEqual({
      kind: "year",
      first: "2025-01-01",
      last: "2025-12-31",
      current: false,
    });
    // A fixed period that holds today is the current one.
    expect(period("period=2026-11")).toMatchObject({ kind: "month", current: true });
    expect(period("period=2026-W45")).toMatchObject({ kind: "week", current: true });
  });

  it("knows which years have a 53rd week", () => {
    expect(period("period=2020-W53")).toMatchObject({ first: "2020-12-28", last: "2021-01-03" });
    expect(period("period=2021-W53")).toMatchObject({ kind: "month" });
    expect(period("period=2025-W01")).toMatchObject({ first: "2024-12-30", last: "2025-01-05" });
    expect(period("period=2025-W53")).toMatchObject({ kind: "month" });
  });

  it("reads the old rolling periods as custom ranges ending today", () => {
    expect(period("period=7d")).toEqual({ kind: "custom", first: "2026-10-29", last: today });
    expect(period("period=30d")).toEqual({ kind: "custom", first: "2026-10-06", last: today });
    expect(period("period=90d")).toEqual({ kind: "custom", first: "2026-08-07", last: today });
  });

  it("lets a custom range override the period, if the API would take it", () => {
    expect(period("period=year&from=2026-10-01&to=2026-10-26")).toEqual({
      kind: "custom",
      first: "2026-10-01",
      last: "2026-10-26",
    });
    expect(period("from=2026-10-26&to=2026-10-01")).toMatchObject({ kind: "month" });
    expect(period("from=2019-01-01&to=2026-10-26")).toMatchObject({ kind: "month" });
    expect(isInsightsRange("2023-10-28", "2026-10-27")).toBe(true);
    expect(isInsightsRange("2023-10-27", "2026-10-27")).toBe(false);
  });

  it("drops devices that cannot be one", () => {
    expect(address(`devices=${device.toUpperCase()},nope,${device}`).devices).toEqual([device]);
    expect(address("devices=nope").devices).toBeNull();
  });
});

describe("the days a period asks for", () => {
  it("ends a current period today, and a complete one on its last day", () => {
    expect(periodRange(period(""), today)).toEqual({ from: "2026-11-01", to: today });
    expect(periodRange(period("period=week"), today)).toEqual({ from: "2026-11-02", to: today });
    expect(periodRange(period("period=2026-10"), today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(periodRange(period("period=year"), today)).toEqual({ from: "2026-01-01", to: today });
    expect(periodRange(period("period=all"), today)).toEqual({ from: null, to: today });
    expect(periodRange(period("period=7d"), today)).toEqual({ from: "2026-10-29", to: today });
  });

  it("builds the request from the address", () => {
    const read = address(`period=2026-10&devices=${device}`);
    expect(insightsParams(read, today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      deviceIds: [device],
      mode: null,
    });
  });
});

describe("moving between periods", () => {
  it("steps back and forth across month and year ends, and never into the future", () => {
    const month = period("period=2026-01");
    expect(stepPeriod(month, -1, today)).toMatchObject({ first: "2025-12-01", last: "2025-12-31" });
    const week = period("period=2026-W01");
    expect(week).toMatchObject({ first: "2025-12-29", last: "2026-01-04" });
    expect(stepPeriod(week, -1, today)).toMatchObject({ first: "2025-12-22" });
    expect(stepPeriod(period("period=2025"), 1, today)).toMatchObject({
      first: "2026-01-01",
      current: true,
    });
    expect(stepPeriod(period(""), 1, today)).toBeNull();
    expect(stepPeriod(period("period=2026-10"), 1, today)).toMatchObject({
      first: "2026-11-01",
      current: true,
    });
    expect(stepPeriod(period("period=all"), -1, today)).toBeNull();
    expect(stepPeriod(period("period=7d"), -1, today)).toBeNull();
  });

  it("changes the unit around the day the period ends on, or today for the current one", () => {
    expect(periodInUnit(period("period=2026-10"), "week", today)).toMatchObject({
      first: "2026-10-26",
      last: "2026-11-01",
    });
    expect(periodInUnit(period("period=2026-10"), "year", today)).toMatchObject({
      first: "2026-01-01",
      current: true,
    });
    expect(periodInUnit(period(""), "week", today)).toMatchObject({
      first: "2026-11-02",
      current: true,
    });
    expect(periodInUnit(period("period=all"), "month", today)).toMatchObject({ current: true });
    expect(periodInUnit(period("period=2025-06"), "year", today)).toMatchObject({
      first: "2025-01-01",
    });
    expect(periodInUnit(period("period=2026-10"), "all", today)).toEqual({ kind: "all" });
  });

  it("writes the address of a period: this month left out, the rest named", () => {
    const write = (value: InsightsPeriod) => withPeriod(new URLSearchParams(), value).toString();
    expect(write(period(""))).toBe("");
    expect(write(period("period=week"))).toBe("period=week");
    expect(write(period("period=year"))).toBe("period=year");
    expect(write(period("period=all"))).toBe("period=all");
    expect(write(period("period=2026-10"))).toBe("period=2026-10");
    expect(write(period("period=2026-W44"))).toBe("period=2026-W44");
    expect(write(period("period=2025"))).toBe("period=2025");
    expect(write(period("period=7d"))).toBe("from=2026-10-29&to=2026-11-04");
    // Round trips.
    for (const query of ["period=2026-W44", "period=2020-W53", "period=2025-03", "period=2024"]) {
      expect(period(new URLSearchParams(write(period(query))).toString())).toEqual(period(query));
    }
    const current = new URLSearchParams(`period=7d&devices=${device}&mode=car&view=x`);
    expect(withPeriod(current, period("period=2026-10")).toString()).toBe(
      `devices=${device}&mode=car&view=x&period=2026-10`,
    );
    expect(withDevices(current, null).has("devices")).toBe(false);
    expect(withDevices(current, [device]).get("devices")).toBe(device);
  });

  it("keeps the period and devices in links, nothing else", () => {
    const current = new URLSearchParams(`period=2026-10&devices=${device}&mode=car&view=x`);
    expect(insightsLink("/insights/time", current)).toBe(
      `/insights/time?period=2026-10&devices=${device}`,
    );
    expect(insightsLink("/insights", new URLSearchParams())).toBe("/insights");
  });
});

describe("what a period is compared with", () => {
  it("takes the whole period before, for a complete one", () => {
    expect(comparisonOf(period("period=2026-10"), today)).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
      partial: false,
    });
    expect(comparisonOf(period("period=2026-W44"), today)).toMatchObject({
      from: "2026-10-19",
      to: "2026-10-25",
    });
    expect(comparisonOf(period("period=2025"), today)).toMatchObject({
      from: "2024-01-01",
      to: "2024-12-31",
    });
  });

  it("takes the same days of the period before, for the unfinished current one", () => {
    expect(comparisonOf(period(""), today)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-04",
      partial: true,
    });
    expect(comparisonOf(period("period=week"), today)).toMatchObject({
      from: "2026-10-26",
      to: "2026-10-28",
      partial: true,
    });
    expect(comparisonOf(period("period=year"), today)).toMatchObject({
      from: "2025-01-01",
      // 4 November is the 308th day of 2026.
      to: "2025-11-04",
    });
  });

  it("clips the days to the period before: 30 March against February", () => {
    const march = period("", "2026-03-30");
    expect(comparisonOf(march, "2026-03-30")).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
      partial: true,
    });
  });

  it("has none for all of the history and for custom ranges", () => {
    expect(comparisonOf(period("period=all"), today)).toBeNull();
    expect(comparisonOf(period("period=7d"), today)).toBeNull();
  });

  it("names it in words: the year only when it differs", () => {
    const name = (query: string, on = today) => {
      const shown = period(query, on);
      const comparison = comparisonOf(shown, on);
      if (comparison === null) throw new Error("no comparison");
      return comparisonName(shown, comparison, format);
    };
    expect(name("period=2026-10")).toBe("September");
    expect(name("period=2026-01")).toBe("December 2025");
    expect(name("")).toBe("the same days of October");
    expect(name("period=2026-W44")).toBe("19–25 Oct");
    expect(name("period=2026-W01")).toBe("22–28 Dec");
    expect(name("period=2026-W02")).toBe("29 Dec 2025 – 4 Jan 2026");
    expect(name("period=week")).toBe("the same days last week");
    expect(name("period=2025")).toBe("2024");
    expect(name("period=year")).toBe("the same days of 2025");
    expect(daysBefore(12)).toBe("the 12 days before");
    expect(daysBefore(1)).toBe("the day before");
  });
});

describe("the period in words", () => {
  const label = (query: string) => periodLabel(period(query), format);
  it("names each unit", () => {
    expect(label("period=2026-10")).toBe("October 2026");
    expect(label("")).toBe("November 2026");
    expect(label("period=2026-W44")).toBe("26 Oct – 1 Nov 2026");
    expect(label("period=2026-W45")).toBe("2–8 Nov 2026");
    expect(label("period=2025")).toBe("2025");
    expect(label("period=all")).toBe("All time");
    expect(label("from=2026-10-06&to=2026-11-04")).toBe("6 Oct – 4 Nov 2026");
    expect(label("from=2025-12-29&to=2026-01-04")).toBe("29 Dec 2025 – 4 Jan 2026");
  });
});
