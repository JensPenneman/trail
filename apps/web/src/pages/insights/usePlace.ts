import { placeKeySchema } from "@trail/contracts/insights";
import { useSearchParams } from "react-router";
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
  return { state, key, query };
}
