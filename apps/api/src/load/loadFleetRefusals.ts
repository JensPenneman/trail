/** The domain of the load test's synthetic accounts: `.invalid` can never be a real address (RFC 2606). */
export const loadAccountDomain = "load.invalid";

/** What `trail load-fleet` checks before it writes anything (docs/perf/README.md). */
export interface LoadFleetConditions {
  /** `LOAD_TEST=true` in the environment. */
  loadTest: boolean;
  /** `LAUNCHWAY_ENVIRONMENT` as Launchway set it (`production`, `preview`), null when unset (the Mac's capped stack). */
  launchwayEnvironment: string | null;
  /** Passkeys in the database: anyone who has ever signed up or signed in here. */
  passkeys: number;
  /** Accounts that are not the load test's own (an address outside `loadAccountDomain`). */
  otherAccounts: number;
}

/** The conditions that only need the environment: checked before the database is opened. */
export function environmentRefusals(
  conditions: Pick<LoadFleetConditions, "loadTest" | "launchwayEnvironment">,
): string[] {
  const refusals: string[] = [];
  if (!conditions.loadTest) {
    refusals.push(
      "LOAD_TEST is not true (a load test sets LOAD_TEST=true in the app's environment)",
    );
  }
  // Fail closed: only a deployment Launchway calls a preview, or none at all (the Mac's capped
  // stack), takes a load test — a renamed or new kind of deployment is refused until allowed.
  const environment = conditions.launchwayEnvironment?.trim().toLowerCase() ?? "";
  if (environment === "production") {
    refusals.push(
      "LAUNCHWAY_ENVIRONMENT is production (load data never shares a database with production)",
    );
  } else if (environment !== "" && environment !== "preview") {
    refusals.push(
      "LAUNCHWAY_ENVIRONMENT is neither unset nor preview (a load test runs on its own stack or in a preview only)",
    );
  }
  return refusals;
}

/**
 * Why the synthetic fleet may not be created in this database; empty when it
 * may. Load data and real data never share a database: a load test runs only
 * where it was switched on, on its own stack or in a preview, and where nobody
 * real has an account — no passkey (nobody ever signed in) and no account but
 * the load test's own.
 */
export function loadFleetRefusals(conditions: LoadFleetConditions): string[] {
  return [...environmentRefusals(conditions), ...databaseRefusals(conditions)];
}

/** The conditions that need the database: nobody real has an account in it. */
export function databaseRefusals(
  conditions: Pick<LoadFleetConditions, "passkeys" | "otherAccounts">,
): string[] {
  const refusals: string[] = [];
  if (conditions.passkeys > 0) {
    refusals.push(
      `the database holds ${conditions.passkeys === 1 ? "a passkey" : `${conditions.passkeys} passkeys`} (someone has signed in here)`,
    );
  }
  if (conditions.otherAccounts > 0) {
    refusals.push(
      `the database holds ${conditions.otherAccounts === 1 ? "an account" : `${conditions.otherAccounts} accounts`} outside the load test's own`,
    );
  }
  return refusals;
}
