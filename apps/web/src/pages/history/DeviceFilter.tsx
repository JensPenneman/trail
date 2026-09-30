import type { DeviceSummary } from "@trail/contracts/device";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import "./DeviceFilter.css";

interface DeviceFilterProps {
  devices: readonly DeviceSummary[];
  selected: readonly string[] | null;
  slotOf: (deviceId: string) => number;
  onChange: (deviceIds: readonly string[] | null) => void;
}

/** Which devices to show; doubles as the legend for the track colours. */
export function DeviceFilter({ devices, selected, slotOf, onChange }: DeviceFilterProps) {
  const isOn = (deviceId: string) => selected === null || selected.includes(deviceId);
  const onCount = devices.filter((device) => isOn(device.id)).length;
  const toggle = (deviceId: string, on: boolean) => {
    const next = devices
      .filter((device) => (device.id === deviceId ? on : isOn(device.id)))
      .map((device) => device.id);
    onChange(next.length === devices.length ? null : next);
  };
  return (
    <fieldset className="device-filter">
      <legend className="device-filter__legend">Devices</legend>
      <div className="device-filter__options">
        {devices.map((device) => {
          const on = isOn(device.id);
          return (
            <label
              key={device.id}
              className={on ? "device-filter__option is-on" : "device-filter__option"}
            >
              <input
                type="checkbox"
                checked={on}
                // The last device stays selected: an empty map explains nothing.
                disabled={on && onCount === 1}
                onChange={(event) => toggle(device.id, event.currentTarget.checked)}
              />
              <DeviceSwatch slot={slotOf(device.id)} shape="line" />
              <span>{device.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
