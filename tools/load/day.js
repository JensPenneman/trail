/*
 * One day of the fleet (docs/design/capacity.md §6.4): the phones of fleet.js
 * and the people of dashboard.js at the same time, with the thresholds of
 * both. run.mjs starts it in the k6 container; the SSE probe runs beside it.
 */
import { peopleScenario, peopleThresholds, personVisit } from "./dashboard.js";
import { phonesScenario, phonesSlot, phonesThresholds, setup } from "./fleet.js";
import { summaryWriter } from "./k6/summary.js";

export const options = {
  scenarios: { phones: phonesScenario, people: peopleScenario },
  thresholds: { ...phonesThresholds, ...peopleThresholds },
  systemTags: [
    "status",
    "method",
    "name",
    "group",
    "check",
    "error",
    "error_code",
    "scenario",
    "expected_response",
  ],
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(90)", "p(95)", "p(99)", "count"],
};

export { personVisit, phonesSlot, setup };

export const handleSummary = summaryWriter("day");
