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
  const all = groups.flatMap((group) => group.devices.map((device) => device.id));
  const isOn = (deviceId: string) => selected === null || selected.includes(deviceId);
  const onCount = all.filter(isOn).length;
  const toggle = (deviceId: string, on: boolean) => {
    const next = all.filter((id) => (id === deviceId ? on : isOn(id)));
    onChange(next.length === all.length ? null : next);
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
