import { emailSchema } from "@trail/contracts/email";
import {
  type OutgoingShare,
  type ShareDuration,
  type SharePrecision,
  shareDurations,
  sharePrecisions,
  type UpdateShareRequest,
} from "@trail/contracts/share";
import { type FormEvent, useState } from "react";
import { useSessionUser } from "../app/useSessionUser";
import { useDeviceColors } from "../devices/useDeviceColors";
import { useFormatter } from "../format/useFormatter";
import { useCreateInvite } from "../queries/useCreateInvite";
import { useCreateShare } from "../queries/useCreateShare";
import { useDevices } from "../queries/useDevices";
import { useUpdateShare } from "../queries/useUpdateShare";
import { useNow } from "../time/useNow";
import { Button } from "../ui/Button";
import { CheckboxField } from "../ui/CheckboxField";
import { ChoiceList } from "../ui/ChoiceList";
import { CopyField } from "../ui/CopyField";
import { Dialog } from "../ui/Dialog";
import { ErrorState } from "../ui/ErrorState";
import { Notice } from "../ui/Notice";
import { TextField } from "../ui/TextField";
import { useAnnounce } from "../ui/useAnnounce";
import { DeviceChoice } from "./DeviceChoice";
import { recipientName } from "./recipientName";
import { durationLabels, expiryText, historyText, precisionInfo } from "./shareText";
import "./ShareDialog.css";

/** Start a share (optionally for a known address: "Share back"), or change one. */
export type ShareDialogMode =
  | { kind: "create"; email?: string }
  | { kind: "edit"; share: OutgoingShare };

interface ShareDialogProps {
  /** Null while closed. */
  mode: ShareDialogMode | null;
  onClose: () => void;
  /** People who share with you and whom you do not share with yet: one tap fills the address. */
  suggestions: readonly { name: string; email: string }[];
}

/** Days of history to offer; a share's own value (set through the API) is offered too. */
const historyDayChoices = [1, 7, 30] as const;

const sameDevices = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((id) => b.includes(id));

/**
 * "Share my location": with whom, which devices, how precisely, with or
 * without history (precise only) and details, and for how long — each choice
 * explained in plain words. After sharing it says whether the person sees
 * you already or will once they sign up, and offers administrators an
 * invitation for an address without an account.
 */
export function ShareDialog({ mode, onClose, suggestions }: ShareDialogProps) {
  const create = useCreateShare();
  const update = useUpdateShare();
  const created = create.data?.share;
  const close = () => {
    create.reset();
    update.reset();
    onClose();
  };
  const title =
    created !== undefined
      ? `Sharing with ${recipientName(created)}`
      : mode?.kind === "edit"
        ? `Sharing with ${recipientName(mode.share)}`
        : "Share my location";
  return (
    <Dialog
      open={mode !== null}
      onClose={close}
      title={title}
      description={
        mode?.kind === "create" && created === undefined
          ? "They see where you are under People until the time you choose, or until you stop. It works one way: you see them only if they share back."
          : undefined
      }
      dismissible={!create.isPending && !update.isPending}
    >
      {mode === null ? null : created === undefined ? (
        <ShareForm
          mode={mode}
          suggestions={suggestions}
          create={create}
          update={update}
          onSaved={close}
        />
      ) : (
        <ShareCreated share={created} onDone={close} />
      )}
    </Dialog>
  );
}

interface ShareFormProps {
  mode: ShareDialogMode;
  suggestions: readonly { name: string; email: string }[];
  create: ReturnType<typeof useCreateShare>;
  update: ReturnType<typeof useUpdateShare>;
  onSaved: () => void;
}

function ShareForm({ mode, suggestions, create, update, onSaved }: ShareFormProps) {
  const user = useSessionUser();
  const format = useFormatter();
  const now = useNow(60_000);
  const devices = useDevices();
  const colors = useDeviceColors();
  const announce = useAnnounce();
  const editing = mode.kind === "edit" ? mode.share : null;
  const [email, setEmail] = useState(mode.kind === "create" ? (mode.email ?? "") : "");
  const [deviceIds, setDeviceIds] = useState<string[] | null>(
    editing?.deviceIds === null || editing === null ? null : [...editing.deviceIds],
  );
  const [precision, setPrecision] = useState<SharePrecision>(editing?.precision ?? "precise");
  const [history, setHistory] = useState<number | null>(editing?.historyDays ?? null);
  const historyOptions = [
    ...new Set<number>([
      ...historyDayChoices,
      ...(editing === null || editing.historyDays === null ? [] : [editing.historyDays]),
    ]),
  ].sort((a, b) => a - b);
  const [includeDetails, setIncludeDetails] = useState(editing?.includeDetails ?? true);
  const [duration, setDuration] = useState<ShareDuration | "keep">(
    editing === null ? "endOfDay" : "keep",
  );
  const [emailError, setEmailError] = useState<string | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;
  const failure = create.error ?? update.error;

  const historyDays = precision === "precise" ? history : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let address: string | null = null;
    if (editing === null) {
      const parsed = emailSchema.safeParse(email);
      const problem = !parsed.success
        ? "Enter the person’s email address."
        : parsed.data === user.email
          ? "That is your own address."
          : null;
      setEmailError(problem);
      address = parsed.success && problem === null ? parsed.data : null;
    }
    const devicesProblem =
      deviceIds !== null && deviceIds.length === 0
        ? "Tick at least one device, or share all of them."
        : null;
    setDevicesError(devicesProblem);
    if (devicesProblem !== null || (editing === null && address === null)) return;

    if (editing === null) {
      if (address === null) return;
      create.mutate(
        {
          email: address,
          deviceIds,
          precision,
          historyDays,
          includeDetails,
          duration: duration === "keep" ? "endOfDay" : duration,
        },
        { onSuccess: () => announce("Your location is shared.") },
      );
      return;
    }
    const body: UpdateShareRequest = {
      ...(sameDevices(deviceIds, editing.deviceIds) ? {} : { deviceIds }),
      ...(precision === editing.precision ? {} : { precision }),
      ...(historyDays === editing.historyDays ? {} : { historyDays }),
      ...(includeDetails === editing.includeDetails ? {} : { includeDetails }),
      ...(duration === "keep" ? {} : { duration }),
    };
    if (Object.keys(body).length === 0) {
      onSaved();
      return;
    }
    update.mutate(
      { shareId: editing.id, body },
      {
        onSuccess: () => {
          announce("Sharing changed.");
          onSaved();
        },
      },
    );
  };

  const offered = suggestions.filter((suggestion) => suggestion.email !== email.trim());

  return (
    <form className="share-form" onSubmit={onSubmit} noValidate>
      {editing === null ? (
        <div className="stack">
          <TextField
            label="Email address"
            hint="Their address on this server. Without an account yet, the share waits for them."
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            error={emailError}
            onChange={(event) => setEmail(event.currentTarget.value)}
            data-autofocus
          />
          {offered.length === 0 ? null : (
            <div className="share-form__suggestions">
              <p className="field__hint">They share with you:</p>
              <div className="cluster">
                {offered.map((suggestion) => (
                  <Button
                    key={suggestion.email}
                    variant="ghost"
                    icon="users"
                    onClick={() => setEmail(suggestion.email)}
                    aria-label={`Share with ${suggestion.name} (${suggestion.email})`}
                  >
                    {suggestion.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

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
            ? "Live only shows where you are now."
            : "Only with a precise location: an approximate one over time would give away more than you chose."
        }
        value={historyDays === null ? "live" : String(historyDays)}
        compact
        options={[
          { value: "live", label: "Live only" },
          ...historyOptions.map((days) => ({
            value: String(days),
            label: historyText(days),
            disabled: precision !== "precise",
          })),
        ]}
        onChange={(value) => setHistory(value === "live" ? null : Number(value))}
      />

      <CheckboxField
        label="Battery and activity"
        hint="Their phone’s battery, and whether you are walking, cycling or driving."
        checked={includeDetails}
        onChange={setIncludeDetails}
      />

      <ChoiceList
        legend="For how long"
        value={duration}
        compact
        options={[
          ...(editing === null
            ? []
            : [
                {
                  value: "keep" as const,
                  label: "No change",
                  description: expiryText(editing.expiresAt, format, now),
                },
              ]),
          ...shareDurations.map((value) => ({ value, label: durationLabels[value] })),
        ]}
        onChange={setDuration}
      />

      {failure === null ? null : (
        <ErrorState
          title={editing === null ? "Your location was not shared" : "The share was not changed"}
          error={failure}
        />
      )}

      <div className="dialog__actions">
        <Button onClick={onSaved} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon={editing === null ? "users" : "check"}
          busy={busy}
        >
          {editing === null ? "Share" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ShareCreated({ share, onDone }: { share: OutgoingShare; onDone: () => void }) {
  const user = useSessionUser();
  const format = useFormatter();
  const now = useNow(60_000);
  const invite = useCreateInvite();
  const name = recipientName(share);
  return (
    <div className="stack">
      {share.status === "pending" ? (
        <Notice tone="info" title="They will see you once they sign up and you confirm">
          <p>
            {share.recipient.email} has no account on this server yet. When someone signs up with
            this address, People asks you to confirm it is them; until then they see nothing. An
            invitation to this address skips the question.
          </p>
        </Notice>
      ) : (
        <Notice tone="success" title={`${name} can see your location now`}>
          <p>
            {precisionInfo[share.precision].short} · {historyText(share.historyDays)} ·{" "}
            {expiryText(share.expiresAt, format, now)}.
          </p>
        </Notice>
      )}
      {share.status === "pending" && user.isAdmin ? (
        invite.data === undefined ? (
          <div className="cluster">
            <Button
              icon="mail"
              busy={invite.isPending}
              onClick={() => invite.mutate({ email: share.recipient.email })}
            >
              Invite {share.recipient.email}
            </Button>
          </div>
        ) : (
          <div className="stack">
            <CopyField label="Invite link" value={invite.data.url} mono={false} />
            <p className="muted">
              Send it to them. It works once, until {format.dateTime(invite.data.invite.expiresAt)}.
            </p>
          </div>
        )
      ) : null}
      {invite.isError ? <ErrorState title="No invite was created" error={invite.error} /> : null}
      <div className="dialog__actions">
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
