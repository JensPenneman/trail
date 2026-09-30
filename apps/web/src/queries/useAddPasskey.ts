import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  addPasskeyOptionsResponseSchema,
  addPasskeyResponseSchema,
} from "@trail/contracts/passkey";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Registers another passkey for the signed-in account on this origin. */
export function useAddPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { ceremonyId, options } = await apiFetch(
        apiPaths.me.passkeyOptions,
        addPasskeyOptionsResponseSchema,
        { method: "POST" },
      );
      const response = await startRegistration({ optionsJSON: options });
      return apiFetch(apiPaths.me.passkeys, addPasskeyResponseSchema, {
        body: { ceremonyId, response },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.passkeys }),
  });
}
