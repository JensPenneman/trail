import { emailSchema } from "@trail/contracts/email";
import { createInvite } from "../../admin/createInvite";
import type { CliContext } from "../cliContext";
import { UsageError } from "../usageError";

/** `trail invite [--email <email>] [--days <n>]` — an invite that needs no admin account. */
export async function inviteCommand(
  ctx: CliContext,
  emailOption: string | undefined,
  daysOption: string | undefined,
): Promise<void> {
  let email: string | null = null;
  if (emailOption !== undefined) {
    const parsed = emailSchema.safeParse(emailOption);
    if (!parsed.success) throw new UsageError(`"${emailOption}" is not an email address`);
    email = parsed.data;
  }
  const days = daysOption === undefined ? 7 : Number(daysOption);
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new UsageError("--days must be a whole number from 1 to 30");
  }

  const { invite, url } = await createInvite(ctx.db, {
    email,
    expiresInDays: days,
    createdBy: null,
    publicUrl: ctx.config.publicUrl,
  });
  console.log(
    email === null ? "Invite link (anyone with it can sign up once):" : `Invite link for ${email}:`,
  );
  console.log("");
  console.log(`  ${url}`);
  console.log("");
  console.log(`Valid until ${invite.expiresAt.toISOString()}.`);
}
