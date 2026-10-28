import type { Pool } from "pg";
import { loadAccountDomain } from "./loadFleetRefusals";

interface AccountsRow {
  passkeys: string | null;
  other_accounts: string | null;
}

/**
 * The passkeys and the accounts outside the load test's own in a database as
 * it is, before any migration — or zeros for a database without Trail's
 * tables yet (a new one). `trail load-fleet` refuses on them before it lets
 * the CLI migrate a database that may be someone's (docs/perf/README.md).
 */
export async function existingAccounts(
  pool: Pool,
): Promise<{ passkeys: number; otherAccounts: number }> {
  const tables = await pool.query<{ users: boolean; passkeys: boolean }>(
    "SELECT to_regclass('public.users') IS NOT NULL AS users, to_regclass('public.passkeys') IS NOT NULL AS passkeys",
  );
  const present = tables.rows[0];
  if (present === undefined || (!present.users && !present.passkeys)) {
    return { passkeys: 0, otherAccounts: 0 };
  }
  const counts = await pool.query<AccountsRow>(
    `SELECT ${present.passkeys ? "(SELECT count(*) FROM passkeys)" : "0"} AS passkeys,
      ${present.users ? "(SELECT count(*) FROM users WHERE email NOT LIKE $1)" : "0"} AS other_accounts`,
    present.users ? [`%@${loadAccountDomain}`] : [],
  );
  return {
    passkeys: Number(counts.rows[0]?.passkeys ?? 0),
    otherAccounts: Number(counts.rows[0]?.other_accounts ?? 0),
  };
}
