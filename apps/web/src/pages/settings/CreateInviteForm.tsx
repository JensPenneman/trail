import { emailSchema } from "@trail/contracts/email";
import { type FormEvent, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useCreateInvite } from "../../queries/useCreateInvite";
import { Button } from "../../ui/Button";
import { CopyField } from "../../ui/CopyField";
import { ErrorState } from "../../ui/ErrorState";
import { Notice } from "../../ui/Notice";
import { TextField } from "../../ui/TextField";

/** Admins invite people by link; the link (with its secret) is shown only right after creating it. */
export function CreateInviteForm() {
  const format = useFormatter();
  const create = useCreateInvite();
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("7");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = email.trim();
    const parsedEmail = typed === "" ? null : emailSchema.safeParse(typed);
    const expiresInDays = Number(days);
    const emailProblem =
      parsedEmail === null || parsedEmail.success
        ? null
        : "Enter a valid email address, or leave it empty.";
    const daysProblem =
      Number.isInteger(expiresInDays) && expiresInDays >= 1 && expiresInDays <= 30
        ? null
        : "Between 1 and 30 days.";
    setEmailError(emailProblem);
    setDaysError(daysProblem);
    if (emailProblem !== null || daysProblem !== null) return;
    create.mutate(
      parsedEmail?.success === true
        ? { email: parsedEmail.data, expiresInDays }
        : { expiresInDays },
    );
  };

  return (
    <div className="stack">
      <form className="settings__invite-form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email address (optional)"
          hint="Only this address can use the invite. Empty: anyone with the link."
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          error={emailError}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <TextField
          label="Valid for (days)"
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          value={days}
          error={daysError}
          onChange={(event) => setDays(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" icon="mail" busy={create.isPending}>
          Create invite
        </Button>
      </form>
      {create.isError ? <ErrorState title="No invite was created" error={create.error} /> : null}
      {create.data === undefined ? null : (
        <Notice tone="success" title="Invite created">
          <CopyField label="Invite link" value={create.data.url} mono={false} />
          <p>
            Send it to {create.data.invite.email ?? "the person you invite"}. It works once, until{" "}
            {format.dateTime(create.data.invite.expiresAt)}, and is not shown again.
          </p>
        </Notice>
      )}
    </div>
  );
}
