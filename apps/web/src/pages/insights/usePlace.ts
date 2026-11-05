import { useQueryClient } from "@tanstack/react-query";
import { type InsightsPlaces, placeKeySchema } from "@trail/contracts/insights";
import { useSearchParams } from "react-router";
import { queryKeys } from "../../api/queryKeys";
import { useInsightsPlace } from "../../queries/useInsightsPlace";
import { useInsightsPeriod } from "./useInsightsPeriod";

/**
 * The place a screen is about, from `?place=` (a query value, never a path:
 * the server's logs keep paths), and its answer. A key that cannot be one
 * asks for nothing.
 */
export function usePlace() {
  const state = useInsightsPeriod();
  const [params] = useSearchParams();
  const parsed = placeKeySchema.safeParse(params.get("place"));
  const key = parsed.success ? parsed.data : null;
  const query = useInsightsPlace(key, state.query());
  // The list of places the person came from, if it is at hand: it names the place before its own
  // answer has come, so the title that takes focus on opening is the name and not "Place".
  const listed = useQueryClient()
    .getQueryData<InsightsPlaces>(queryKeys.insightsPlaces(state.query()))
    ?.places.find((place) => place.key === key);
  return { state, key, query, listed };
}
