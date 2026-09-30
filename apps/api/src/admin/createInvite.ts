import type { InviteRow } from "../auth/findValidInvite";
import type { Executor } from "../db/database";
import { invites } from "../db/schema/invites";
import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";

/** Creates an invite (admin UI or CLI); the URL with the secret token is only returned here. */
export async function createInvite(
  db: Executor,
  input: {
    email: string | null;
    expiresInDays: number;
    createdBy: string | null;
    publicUrl: string;
  },
): Promise<{ invite: InviteRow; url: string }> {
  const token = randomToken();
  const [invite] = await db
    .insert(invites)
    .values({
      tokenHash: hashToken(token),
      email: input.email,
      createdBy: input.createdBy,
      expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
    })
    .returning();
  if (invite === undefined) throw new Error("Storing the invite returned no row");
  return { invite, url: `${input.publicUrl}/invite/${token}` };
}
