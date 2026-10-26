import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { shareLinkListResponseSchema } from "@trail/contracts/shareLink";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The signed-in person's public links that were not turned off. */
export function useShareLinks() {
  return useQuery({
    queryKey: queryKeys.shareLinks,
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.shareLinks.root, shareLinkListResponseSchema, { signal }),
    select: (response) => response.links,
  });
}
