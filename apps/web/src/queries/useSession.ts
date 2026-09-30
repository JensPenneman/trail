import { useQuery } from "@tanstack/react-query";
import { sessionQuery } from "./sessionQuery";

/** `data` is the signed-in user, `null` when signed out. */
export function useSession() {
  return useQuery(sessionQuery);
}
