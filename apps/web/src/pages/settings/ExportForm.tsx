import { apiPaths } from "@trail/contracts/apiPaths";
import { exportFormats } from "@trail/contracts/exportQuery";
import { useState } from "react";
import { apiUrl } from "../../api/apiUrl";
import { useSessionUser } from "../../app/useSessionUser";
import { useDevices } from "../../queries/useDevices";
import { addDays } from "../../time/addDays";
import { localDayRange } from "../../time/localDayRange";
import { useToday } from "../../time/useToday";
import { Icon } from "../../ui/Icon";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";

const formatLabels: Record<(typeof exportFormats)[number], string> = {
  geojson: "GeoJSON — for GIS tools and scripts",
  gpx: "GPX 1.1 — for mapping and fitness apps",
  csv: "CSV — for spreadsheets",
};

/**
 * Downloads points as a file. The browser fetches it directly (the session
 * cookie goes along), so even a very large export streams to disk.
 */
export function ExportForm() {
  const user = useSessionUser();
  const devices = useDevices();
  const today = useToday();
  const [format, setFormat] = useState<(typeof exportFormats)[number]>("geojson");
  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const valid = from !== "" && to !== "" && from <= to;
  const range = valid ? localDayRange(from, to, user.timezone) : null;
  const href =
    range === null
      ? undefined
      : apiUrl(apiPaths.export, {
          ...range,
          format,
          deviceIds: deviceId === "" ? undefined : [deviceId],
        });

  return (
    <div className="stack">
      <div className="settings__grid">
        <SelectField
          label="Format"
          value={format}
          onChange={(event) => {
            const next = exportFormats.find((candidate) => candidate === event.currentTarget.value);
            if (next !== undefined) setFormat(next);
          }}
        >
          {exportFormats.map((candidate) => (
            <option key={candidate} value={candidate}>
              {formatLabels[candidate]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Devices"
          value={deviceId}
          onChange={(event) => setDeviceId(event.currentTarget.value)}
        >
          <option value="">All devices</option>
          {(devices.data ?? []).map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </SelectField>
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
          error={valid ? null : "The first day must come before the last day."}
          onChange={(event) => setTo(event.currentTarget.value)}
        />
      </div>
      <div className="cluster">
        {href === undefined ? null : (
          <a className="button button--primary" href={href} download>
            <Icon name="download" />
            <span>Download</span>
          </a>
        )}
        <p className="muted">Both days are included, in your time zone.</p>
      </div>
    </div>
  );
}
