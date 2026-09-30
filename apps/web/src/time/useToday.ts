import { useSessionUser } from "../app/useSessionUser";
import { localDateOf } from "./localDateOf";
import { useNow } from "./useNow";

/** Today's date `YYYY-MM-DD` in the signed-in person's time zone; rolls over at their midnight. */
export function useToday(): string {
  const { timezone } = useSessionUser();
  const now = useNow(30_000);
  return localDateOf(now, timezone);
}
