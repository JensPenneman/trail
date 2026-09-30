import { type FormEvent, useMemo, useState } from "react";
import { ApiError } from "../../api/ApiError";
import { useSessionUser } from "../../app/useSessionUser";
import { useUpdateProfile } from "../../queries/useUpdateProfile";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import { useAnnounce } from "../../ui/useAnnounce";
import { timeZoneOptions } from "./timeZoneOptions";

/** Display name and the time zone that decides "today", day boundaries and every shown time. */
export function ProfileSection({ headingId }: { headingId: string }) {
  const user = useSessionUser();
  const update = useUpdateProfile();
  const announce = useAnnounce();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [timezone, setTimezone] = useState(user.timezone);
  const [nameError, setNameError] = useState<string | null>(null);
  const options = useMemo(() => timeZoneOptions(user.timezone), [user.timezone]);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const changed = displayName.trim() !== user.displayName || timezone !== user.timezone;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = displayName.trim();
    if (name === "" || name.length > 80) {
      setNameError("Use 1 to 80 characters.");
      return;
    }
    setNameError(null);
    update.mutate(
      {
        ...(name === user.displayName ? {} : { displayName: name }),
        ...(timezone === user.timezone ? {} : { timezone }),
      },
      {
        onSuccess: () => announce("Profile saved."),
        onError: (error) => {
          if (error instanceof ApiError)
            setNameError(error.fields["displayName"]?.join(" ") ?? null);
        },
      },
    );
  };

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Profile
      </h2>
      <form className="card" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email address"
          value={user.email}
          readOnly
          hint="Your sign-in name; it cannot be changed."
        />
        <TextField
          label="Display name"
          value={displayName}
          maxLength={80}
          required
          autoComplete="name"
          error={nameError}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
        <SelectField
          label="Time zone"
          hint="Decides where days begin and end in History and which points count as “today”."
          value={timezone}
          onChange={(event) => setTimezone(event.currentTarget.value)}
        >
          {options.map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        {deviceZone !== timezone ? (
          <p className="muted">
            This device is set to {deviceZone.replaceAll("_", " ")}.{" "}
            <Button variant="ghost" onClick={() => setTimezone(deviceZone)}>
              Use it
            </Button>
          </p>
        ) : null}
        {update.isError && nameError === null ? (
          <ErrorState title="The profile was not saved" error={update.error} />
        ) : null}
        <div className="cluster">
          <Button type="submit" variant="primary" busy={update.isPending} disabled={!changed}>
            Save profile
          </Button>
        </div>
      </form>
    </section>
  );
}
