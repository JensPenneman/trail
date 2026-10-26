import { addDays } from "../../time/addDays";
import { startOfLocalDay } from "../../time/startOfLocalDay";

/** How long a new token works, as the dialog offers it. */
export const expiryChoices = [
  { value: "30-days", label: "In 30 days" },
  { value: "90-days", label: "In 90 days" },
  { value: "1-year", label: "In 1 year" },
  { value: "date", label: "On a date of your choice" },
  { value: "never", label: "Never" },
] as const;
export type ExpiryChoice = (typeof expiryChoices)[number]["value"];

const dayMs = 86_400_000;
const spans: Partial<Record<ExpiryChoice, number>> = {
  "30-days": 30 * dayMs,
  "90-days": 90 * dayMs,
  "1-year": 365 * dayMs,
};

/**
 * The instant a new token stops working (ISO), or null for never. A chosen
 * date is the last day it works: it expires at the end of that day in the
 * account's time zone (a millisecond before the next one begins, so the list
 * shows the chosen day).
 */
export function expiryInstant(
  choice: ExpiryChoice,
  input: { now: number; date: string; timeZone: string },
): string | null {
  if (choice === "never") return null;
  if (choice === "date") {
    return new Date(startOfLocalDay(addDays(input.date, 1), input.timeZone) - 1).toISOString();
  }
  return new Date(input.now + (spans[choice] ?? 0)).toISOString();
}
