import { type SharePrecision, sharePrecisions } from "@trail/contracts/share";
import { type CreateShareLinkRequest, maxShareLinkHistoryDays } from "@trail/contracts/shareLink";
import { type FormEvent, useState } from "react";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useDevices } from "../../queries/useDevices";
import { DeviceChoice } from "../../sharing/DeviceChoice";
import { historyText, precisionInfo } from "../../sharing/shareText";
import { Button } from "../../ui/Button";
import { CheckboxField } from "../../ui/CheckboxField";
import { ChoiceList } from "../../ui/ChoiceList";
import { ErrorState } from "../../ui/ErrorState";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import "./settings.css";

const expiryChoices = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 24 * 7, label: "7 days" },
  { hours: 24 * 30, label: "30 days" },
] as const;

const historyChoices = [1, 3, maxShareLinkHistoryDays] as const;

interface ShareLinkFormProps {
  busy: boolean;
  /** Why the last attempt failed, or null. */
  error: unknown;
  onSubmit: (body: CreateShareLinkRequest) => void;
  onCancel: () => void;
}

/**
 * The settings of a new public link: a label for its page, the devices,
 * precision, history (precise only) and details, and when it stops working.
 */
export function ShareLinkForm({ busy, error, onSubmit, onCancel }: ShareLinkFormProps) {
  const devices = useDevices();
  const colors = useDeviceColors();
  const [label, setLabel] = useState("");
  const [deviceIds, setDeviceIds] = useState<string[] | null>(null);
  const [precision, setPrecision] = useState<SharePrecision>("precise");
  const [history, setHistory] = useState<number | null>(null);
  const [includeDetails, setIncludeDetails] = useState(false);
  const [hours, setHours] = useState("24");
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (deviceIds !== null && deviceIds.length === 0) {
      setDevicesError("Tick at least one device, or share all of them.");
      return;
    }
    setDevicesError(null);
    const trimmed = label.trim();
    onSubmit({
      ...(trimmed === "" ? {} : { label: trimmed }),
      deviceIds,
      precision,
      historyDays: precision === "precise" ? history : null,
      includeDetails,
      expiresAt: new Date(Date.now() + Number(hours) * 3_600_000).toISOString(),
    });
  };

  return (
    <form className="share-link-form" onSubmit={submit} noValidate>
      <TextField
        label="Label (optional)"
        hint="Visitors see it as the page’s title; without one it reads “Shared location”."
        placeholder="Shared location"
        maxLength={60}
        autoComplete="off"
        data-autofocus
        value={label}
        onChange={(event) => setLabel(event.currentTarget.value)}
      />
      <DeviceChoice
        devices={devices.data ?? []}
        value={deviceIds}
        onChange={setDeviceIds}
        slotOf={colors.slot}
        error={devicesError}
      />
      <ChoiceList
        legend="How precisely"
        value={precision}
        options={sharePrecisions.map((value) => ({
          value,
          label: precisionInfo[value].label,
          description: precisionInfo[value].description,
        }))}
        onChange={(value) => {
          setPrecision(value);
          if (value !== "precise") setHistory(null);
        }}
      />
      <ChoiceList
        legend="Where you have been"
        hint={
          precision === "precise"
            ? "The page draws your route of the time you pick."
            : "Only with a precise location."
        }
        value={history === null ? "live" : String(history)}
        compact
        options={[
          { value: "live", label: "Live only" },
          ...historyChoices.map((days) => ({
            value: String(days),
            label: historyText(days),
            disabled: precision !== "precise",
          })),
        ]}
        onChange={(value) => setHistory(value === "live" ? null : Number(value))}
      />
      <CheckboxField
        label="Battery and activity"
        hint="Off by default: anyone with the link would see them."
        checked={includeDetails}
        onChange={setIncludeDetails}
      />
      <SelectField
        label="Stops working after"
        value={hours}
        onChange={(event) => setHours(event.currentTarget.value)}
      >
        {expiryChoices.map((choice) => (
          <option key={choice.hours} value={String(choice.hours)}>
            {choice.label}
          </option>
        ))}
      </SelectField>
      {error === null ? null : <ErrorState title="No link was made" error={error} />}
      <div className="dialog__actions">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="globe" busy={busy}>
          Make link
        </Button>
      </div>
    </form>
  );
}
