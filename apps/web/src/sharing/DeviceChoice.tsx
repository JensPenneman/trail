import type { DeviceSummary } from "@trail/contracts/device";
import { useId } from "react";
import { ChoiceList } from "../ui/ChoiceList";
import { DeviceSwatch } from "../ui/DeviceSwatch";
import { Icon } from "../ui/Icon";
import "./DeviceChoice.css";

interface DeviceChoiceProps {
  devices: readonly DeviceSummary[];
  /** Null = every device, also later ones. */
  value: readonly string[] | null;
  onChange: (value: string[] | null) => void;
  slotOf: (deviceId: string) => number;
  error?: string | null;
}

/** Which devices to share: all of them (also the ones added later), or the ones ticked. */
export function DeviceChoice({ devices, value, onChange, slotOf, error }: DeviceChoiceProps) {
  const errorId = useId();
  const picked = value ?? [];
  return (
    <div className="device-choice">
      <ChoiceList
        legend="Devices"
        value={value === null ? "all" : "some"}
        compact
        options={[
          { value: "all", label: "All my devices", description: "Also the ones you add later." },
          {
            value: "some",
            label: "Only some",
            description: "Just the devices you tick.",
            disabled: devices.length === 0,
          },
        ]}
        onChange={(choice) =>
          onChange(choice === "all" ? null : devices.slice(0, 1).map((device) => device.id))
        }
      />
      {value === null ? null : (
        <fieldset
          className="device-choice__picks"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
        >
          <legend className="visually-hidden">Devices to share</legend>
          {devices.map((device) => (
            <label key={device.id} className="device-choice__pick">
              <input
                type="checkbox"
                checked={picked.includes(device.id)}
                onChange={(event) =>
                  onChange(
                    event.currentTarget.checked
                      ? [...picked, device.id]
                      : picked.filter((id) => id !== device.id),
                  )
                }
              />
              <DeviceSwatch slot={slotOf(device.id)} />
              <span>{device.name}</span>
            </label>
          ))}
          {error ? (
            <p className="field__error" id={errorId}>
              <Icon name="warning" />
              <span>{error}</span>
            </p>
          ) : null}
        </fieldset>
      )}
    </div>
  );
}
