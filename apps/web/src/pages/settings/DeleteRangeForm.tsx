import { type FormEvent, useState } from "react";
import { useSessionUser } from "../../app/useSessionUser";
import { useFormatter } from "../../format/useFormatter";
import { useDeleteLocations } from "../../queries/useDeleteLocations";
import { useDevices } from "../../queries/useDevices";
import { localDayRange } from "../../time/localDayRange";
import { useToday } from "../../time/useToday";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { Notice } from "../../ui/Notice";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";

/** Removes one device's points, visits and trips for some days — after an explicit confirmation. */
export function DeleteRangeForm() {
  const user = useSessionUser();
  const format = useFormatter();
  const devices = useDevices();
  const today = useToday();
  const remove = useDeleteLocations();
  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const device = devices.data?.find((candidate) => candidate.id === deviceId);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (device === undefined) {
      setError("Choose the device whose data should go.");
      return;
    }
    if (from === "" || to === "" || from > to) {
      setError("The first day must come before the last day.");
      return;
    }
    setError(null);
    remove.reset();
    setConfirming(true);
  };

  const period = from === to ? format.day(from) : `${format.day(from)} – ${format.day(to)}`;

  return (
    <>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="settings__grid">
          <SelectField
            label="Device"
            value={deviceId}
            onChange={(event) => setDeviceId(event.currentTarget.value)}
          >
            <option value="">Choose a device</option>
            {(devices.data ?? []).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </SelectField>
          <span aria-hidden="true" />
          <TextField
            label="From"
            type="date"
            max={today}
            value={from}
            onChange={(event) => setFrom(event.currentTarget.value)}
          />
          <TextField
            label="To"
            type="date"
            max={today}
            value={to}
            onChange={(event) => setTo(event.currentTarget.value)}
          />
        </div>
        {error === null ? null : (
          <Notice tone="warning" role="alert">
            <p>{error}</p>
          </Notice>
        )}
        {remove.data === undefined ? null : (
          <Notice tone="success" role="status" title="Deleted">
            <p>{format.count(remove.data.deleted)} records were removed.</p>
          </Notice>
        )}
        <div className="cluster">
          <Button type="submit" variant="danger-outline" icon="trash">
            Delete data…
          </Button>
        </div>
      </form>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this data?"
        size="s"
        dismissible={!remove.isPending}
      >
        <p>
          Every point, visit and trip of <strong>{device?.name}</strong> on{" "}
          <strong>{period}</strong> is removed for good.
        </p>
        {remove.isError ? <ErrorState title="Nothing was deleted" error={remove.error} /> : null}
        <div className="dialog__actions">
          <Button onClick={() => setConfirming(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon="trash"
            busy={remove.isPending}
            onClick={() =>
              remove.mutate(
                { ...localDayRange(from, to, user.timezone), deviceId },
                { onSuccess: () => setConfirming(false) },
              )
            }
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  );
}
