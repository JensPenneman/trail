import { type FormEvent, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useConfig } from "../../queries/useConfig";
import { useCreatePasskeyLink } from "../../queries/useCreatePasskeyLink";
import { Button } from "../../ui/Button";
import { CopyField } from "../../ui/CopyField";
import { ErrorState } from "../../ui/ErrorState";
import { QrCode } from "../../ui/QrCode";
import { TextField } from "../../ui/TextField";

/**
 * Passkeys belong to one web address. A one-time link (15 minutes) lets this
 * account add a passkey on another device, or for another address this server
 * answers on (e.g. the LAN address before the public domain is live).
 */
export function PasskeyLinkSection({ headingId }: { headingId: string }) {
  const format = useFormatter();
  const config = useConfig();
  const create = useCreatePasskeyLink();
  const [origin, setOrigin] = useState("");
  const [originError, setOriginError] = useState<string | null>(null);
  const publicUrl = config.data?.publicUrl ?? window.location.origin;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = origin.trim();
    if (typed !== "") {
      try {
        new URL(typed);
      } catch {
        setOriginError("Enter a full address such as https://trail.example.com.");
        return;
      }
    }
    setOriginError(null);
    create.mutate(typed === "" ? {} : { origin: new URL(typed).origin });
  };

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Add a passkey on another device or address
      </h2>
      <div className="card">
        <p>
          Open the link on the other device (or scan its code) to create a passkey there. It works
          once and expires after 15 minutes.
        </p>
        <form className="stack" onSubmit={onSubmit} noValidate>
          <TextField
            label="Address the link opens on"
            hint={`Leave empty for ${publicUrl}. Other addresses must be allowed by the server (ADDITIONAL_ORIGINS).`}
            placeholder={publicUrl}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={origin}
            error={originError}
            onChange={(event) => setOrigin(event.currentTarget.value)}
          />
          <div className="cluster">
            <Button type="submit" variant="primary" icon="key" busy={create.isPending}>
              Create link
            </Button>
          </div>
        </form>
        {create.isError ? <ErrorState title="No link was created" error={create.error} /> : null}
        {create.data === undefined ? null : (
          <div className="settings__link-result">
            <QrCode value={create.data.url} label="Code with the one-time passkey link" />
            <div className="stack">
              <CopyField label="One-time link" value={create.data.url} mono={false} />
              <p className="muted">
                Valid until {format.time(create.data.expiresAt)}, for one use.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
