import { describe, expect, it } from "vitest";
import { parseHistorySelection } from "../src/pages/history/parseHistorySelection";

const today = "2026-09-30";
const parse = (query: string) => parseHistorySelection(new URLSearchParams(query), today);

describe("parseHistorySelection", () => {
  it("shows today by default", () => {
    expect(parse("")).toEqual({ mode: "day", from: today, to: today, deviceIds: null });
  });

  it("reads a day and a device filter", () => {
    expect(parse("date=2026-09-12&devices=a,b")).toEqual({
      mode: "day",
      from: "2026-09-12",
      to: "2026-09-12",
      deviceIds: ["a", "b"],
    });
  });

  it("repairs impossible links instead of failing", () => {
    expect(parse("date=2026-13-40").from).toBe(today);
    expect(parse("date=2027-01-01").from).toBe(today);
    expect(parse("from=2026-09-20&to=2026-09-10")).toMatchObject({
      from: "2026-09-10",
      to: "2026-09-20",
    });
  });

  it("shortens a period to the API's 93 days", () => {
    expect(parse("from=2026-01-01&to=2026-09-30")).toMatchObject({
      mode: "range",
      from: "2026-01-01",
      to: "2026-04-03",
    });
  });
});
