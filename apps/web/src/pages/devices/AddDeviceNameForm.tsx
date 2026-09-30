import { type DeviceWithCredentialsResponse, deviceKeySchema } from "@trail/contracts/device";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/ApiError";
import { useCreateDevice } from "../../queries/useCreateDevice";
import { Button } from "../../ui/Button";
import { errorMessage } from "../../ui/errorMessage";
import { Icon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { TextField } from "../../ui/TextField";

interface AddDeviceNameFormProps {
  onCreated: (response: DeviceWithCredentialsResponse) => void;
  onCancel: () => void;
}

function nameProblem(name: string): string | null {
  if (name === "") return "Give the device a name.";
  if (name.length > 60) return "Use at most 60 characters.";
  return null;
}

/** First step of adding a device: its name and, optionally, Overland's device ID. */
export function AddDeviceNameForm({ onCreated, onCancel }: AddDeviceNameFormProps) {
  const createDevice = useCreateDevice();
  const [name, setName] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    const key = deviceKey.trim();
    const keyProblem =
      key === "" || deviceKeySchema.safeParse(key).success
        ? null
        : "Use lower-case letters, digits and single dashes (at most 40).";
    setNameError(nameProblem(trimmed));
    setKeyError(keyProblem);
    if (nameProblem(trimmed) !== null || keyProblem !== null) return;
    createDevice.mutate(key === "" ? { name: trimmed } : { name: trimmed, deviceKey: key }, {
      onSuccess: onCreated,
      onError: (error) => {
        if (!(error instanceof ApiError)) return;
        setNameError(error.fields["name"]?.join(" ") ?? null);
        setKeyError(
          error.fields["deviceKey"]?.join(" ") ??
            (error.code === "conflict"
              ? "Another of your devices already uses this device ID."
              : null),
        );
      },
    });
  };

  // Field problems are shown on the fields; anything else gets a notice.
  const generalError =
    createDevice.error instanceof ApiError &&
    (Object.keys(createDevice.error.fields).length > 0 || createDevice.error.code === "conflict")
      ? null
      : createDevice.error;

  return (
    <form className="add-device" onSubmit={onSubmit} noValidate>
      <TextField
        label="Name"
        hint="How it appears in Trail, e.g. “Jens’s iPhone”."
        value={name}
        maxLength={60}
        required
        autoComplete="off"
        data-autofocus
        error={nameError}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <details className="add-device__advanced disclosure">
        <summary>
          Device ID (optional)
          <Icon name="chevronDown" className="disclosure__chevron" />
        </summary>
        <TextField
          label="Device ID"
          hint="Overland’s “Device ID”, sent with every point. Leave it empty to derive one from the name."
          value={deviceKey}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          error={keyError}
          onChange={(event) => setDeviceKey(event.currentTarget.value)}
        />
      </details>
      {generalError === null ? null : (
        <Notice tone="danger" role="alert" title="The device was not added">
          <p>{errorMessage(generalError)}</p>
        </Notice>
      )}
      <div className="dialog__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" icon="plus" busy={createDevice.isPending}>
          Add device
        </Button>
      </div>
    </form>
  );
}
