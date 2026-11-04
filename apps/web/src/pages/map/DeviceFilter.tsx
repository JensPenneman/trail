import { useState } from "react";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import "./FilterChips.css";

/** The devices of one person, as the filter lists them. */
export interface DeviceFilterGroup {
  key: string;
  /** The person's name; shown when the filter lists more than one person. */
  name: string;
  /** Their devices with their colours: the signed-in person's own, or the person's. */
  devices: readonly { id: string; name: string; slot: number; palette: "device" | "person" }[];
}

interface DeviceFilterProps {
  groups: readonly DeviceFilterGroup[];
  /** Device ids shown, or null for all of them. */
  selected: readonly string[] | null;
  onChange: (deviceIds: readonly string[] | null) => void;
}

/** Which devices to show, grouped by person; doubles as the legend for the track colours. */
export function DeviceFilter({ groups, selected, onChange }: DeviceFilterProps) {
  // The checkbox follows the press at once; the address catches up (it is the truth once it does).
  const [pending, setPending] = useState<{
    value: readonly string[] | null;
    base: string;
  } | null>(null);
  const addressKey = selected === null ? "" : `ids:${selected.join(",")}`;
  // A press lasts until the address moves: from then on the address rules, also when it comes
  // back to where the press was made.
  if (pending !== null && pending.base !== addressKey) setPending(null);
  const shown = pending !== null && pending.base === addressKey ? pending.value : selected;
  const all = groups.flatMap((group) => group.devices.map((device) => device.id));
  const isOn = (deviceId: string) => shown === null || shown.includes(deviceId);
  const onCount = all.filter(isOn).length;
  const toggle = (deviceId: string, on: boolean) => {
    const next = all.filter((id) => (id === deviceId ? on : isOn(id)));
    const value = next.length === all.length ? null : next;
    setPending({ value, base: addressKey });
    onChange(value);
  };
  const options = (devices: DeviceFilterGroup["devices"]) => (
    <div className="filter-chips__options">
      {devices.map((device) => {
        const on = isOn(device.id);
        return (
          <label key={device.id} className={on ? "filter-chip is-on" : "filter-chip"}>
            <input
              type="checkbox"
              checked={on}
              // The last device stays selected: an empty map explains nothing.
              disabled={on && onCount === 1}
              onChange={(event) => toggle(device.id, event.currentTarget.checked)}
            />
            <DeviceSwatch slot={device.slot} shape="line" palette={device.palette} />
            <span>{device.name}</span>
          </label>
        );
      })}
    </div>
  );
  return (
    <fieldset className="filter-chips">
      <legend className="filter-chips__legend">Devices</legend>
      {groups.length > 1
        ? groups.map((group) => (
            <fieldset key={group.key} className="filter-chips__group">
              <legend className="filter-chips__group-legend">{group.name}</legend>
              {options(group.devices)}
            </fieldset>
          ))
        : options(groups.flatMap((group) => group.devices))}
    </fieldset>
  );
}
