/** Why a sign-in, sign-up or passkey ceremony did not complete, in terms a person can act on. */
export type AuthProblem =
  | { kind: "cancelled" }
  | { kind: "unsupported" }
  | { kind: "insecure_origin" }
  | { kind: "signup_not_allowed" }
  | { kind: "no_passkey_for_origin" }
  | { kind: "unknown_credential" }
  | { kind: "expired" }
  | { kind: "already_registered" }
  | { kind: "rate_limited" }
  | { kind: "link_invalid" }
  | { kind: "network"; message: string }
  | { kind: "failed"; message: string };
