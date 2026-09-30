import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { passkeyListResponseSchema } from "@trail/contracts/passkey";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

export function usePasskeys() {
  return useQuery({
    queryKey: queryKeys.passkeys,
    queryFn: ({ signal }) => apiFetch(apiPaths.me.passkeys, passkeyListResponseSchema, { signal }),
    select: (response) => response.passkeys,
  });
}
