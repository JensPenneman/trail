import { sql } from "drizzle-orm";
import { toIso } from "../../db/toIso";
import type { CliContext } from "../cliContext";

interface UserLine extends Record<string, unknown> {
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  devices: number;
  passkeys: number;
}

/** `trail users` — every account with its device and passkey counts. */
export async function usersCommand(ctx: CliContext): Promise<void> {
  const result = await ctx.db.execute<UserLine>(sql`
    SELECT u.email, u.display_name, u.is_admin, u.created_at,
      (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id) AS devices,
      (SELECT count(*)::int FROM passkeys p WHERE p.user_id = u.id) AS passkeys
    FROM users u
    ORDER BY u.created_at
  `);
  if (result.rows.length === 0) {
    console.log("No accounts yet. Create an invite with: trail invite");
    return;
  }
  console.table(
    result.rows.map((row) => ({
      email: row.email,
      name: row.display_name,
      admin: row.is_admin ? "yes" : "",
      devices: row.devices,
      passkeys: row.passkeys,
      created: toIso(row.created_at).slice(0, 10),
    })),
  );
}
