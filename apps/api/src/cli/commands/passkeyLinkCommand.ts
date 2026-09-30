import { emailSchema } from "@trail/contracts/email";
import { eq } from "drizzle-orm";
import { normaliseOrigin } from "../../config/normaliseOrigin";
import { users } from "../../db/schema/users";
import { createPasskeyLink } from "../../me/createPasskeyLink";
import type { CliContext } from "../cliContext";
import { UsageError } from "../usageError";

/** `trail passkey-link <email> [--origin <url>]` — account recovery. */
export async function passkeyLinkCommand(
  ctx: CliContext,
  email: string | undefined,
  originOption: string | undefined,
): Promise<void> {
  const address = emailSchema.safeParse(email ?? "");
  if (!address.success) throw new UsageError("passkey-link needs the email address of an account");
  const origin = originOption === undefined ? ctx.config.publicUrl : normaliseOrigin(originOption);
  if (origin === null || !ctx.config.allowedOrigins.includes(origin)) {
    throw new UsageError(`--origin must be one of: ${ctx.config.allowedOrigins.join(", ")}`);
  }
  const [user] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, address.data))
    .limit(1);
  if (user === undefined) throw new Error(`No account uses ${address.data}`);

  const link = await createPasskeyLink(ctx.db, { userId: user.id, origin, createdBy: "cli" });
  console.log(`Open this link on ${origin} to add a passkey to ${address.data}:`);
  console.log("");
  console.log(`  ${link.url}`);
  console.log("");
  console.log(`It works once and expires at ${link.expiresAt.toISOString()} (15 minutes).`);
}
