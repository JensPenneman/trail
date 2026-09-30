import {
  type AuthenticationResponseJSON,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type PasskeyOptionsResponse, passkeyOptionsResponseSchema } from "@trail/contracts/auth";
import type { SessionUser } from "@trail/contracts/user";
import { useEffect, useEffectEvent, useState } from "react";
import { apiFetch } from "../api/apiFetch";
import type { AuthProblem } from "./AuthProblem";
import { classifyAuthError } from "./classifyAuthError";
import { finishAssertion } from "./finishAssertion";

/** Ceremonies expire on the server after 5 minutes; a waiting autofill request is renewed before that. */
const renewAfterMs = 4 * 60_000;
/** After a failure nobody asked for (server down, browser refused), try again this much later. */
const quietRetryMs = 30_000;

/**
 * Offers the browser's saved passkeys in the email field's autofill
 * (conditional mediation) for as long as the login screen is idle. It is a
 * background convenience: failures before the person picks a passkey stay
 * silent; only a rejected pick (unknown or expired) is reported. Paused while
 * a button-started ceremony runs, and cancelled cleanly when leaving the page.
 */
export function useConditionalSignIn(options: {
  enabled: boolean;
  inputRef: { readonly current: HTMLInputElement | null };
  onSignedIn: (user: SessionUser) => void;
  onProblem: (problem: AuthProblem) => void;
}): void {
  const { enabled, inputRef } = options;
  const [round, setRound] = useState(0);
  const signedIn = useEffectEvent(options.onSignedIn);
  const problem = useEffectEvent(options.onProblem);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` restarts the request on purpose
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const restart = (delayMs: number) => {
      if (active) retry = setTimeout(() => setRound((value) => value + 1), delayMs);
    };
    const renew = setInterval(() => {
      // Never pull the list away while the person may be choosing from it.
      if (document.activeElement !== inputRef.current) setRound((value) => value + 1);
    }, renewAfterMs);

    void (async () => {
      if (!(await browserSupportsWebAuthnAutofill()) || !active) return;
      let ceremony: PasskeyOptionsResponse;
      let response: AuthenticationResponseJSON;
      try {
        ceremony = await apiFetch(apiPaths.auth.passkey, passkeyOptionsResponseSchema, {
          method: "POST",
        });
        if (!active) return;
        response = await startAuthentication({
          optionsJSON: ceremony.options,
          useBrowserAutofill: true,
        });
      } catch {
        // Aborted by a newer request or by leaving the page, refused by the browser, or the
        // server is unreachable: nothing the person did, so nothing to say.
        restart(quietRetryMs);
        return;
      }
      if (!active) return;
      try {
        const result = await finishAssertion(ceremony.ceremonyId, response);
        if (active) signedIn(result.user);
      } catch (error) {
        if (!active) return;
        problem(classifyAuthError(error));
        restart(0);
      }
    })();

    return () => {
      active = false;
      clearInterval(renew);
      clearTimeout(retry);
      WebAuthnAbortService.cancelCeremony();
    };
  }, [enabled, inputRef, round]);
}
