import { apiPaths } from "@trail/contracts/apiPaths";
import { type FinishAuthResponse, passkeyOptionsResponseSchema } from "@trail/contracts/auth";
import { apiFetch } from "../api/apiFetch";
import { assertAndFinish } from "./assertAndFinish";

/** Usernameless sign-in from the "Use a passkey" button: the passkey itself says who is signing in. */
export async function signInWithPasskey(): Promise<FinishAuthResponse> {
  const { ceremonyId, options } = await apiFetch(
    apiPaths.auth.passkey,
    passkeyOptionsResponseSchema,
    { method: "POST" },
  );
  return assertAndFinish(ceremonyId, options);
}
