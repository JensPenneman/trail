import type { DataAccessResource } from "@trail/contracts/dataAccess";
import type { exportFormats } from "@trail/contracts/exportQuery";
import type { Formatter } from "../format/createFormatter";
import { precisionInfo } from "../sharing/shareText";
import { levelLabels } from "../transport/LevelControl";
import { transportModeInfo } from "../transport/transportModes";
import { counted } from "./viewerSentence";

/**
 * Names to show for the ids a line names: devices, shares (the person), links
 * and tokens. Null while a list has not loaded: then neither a name nor that
 * the thing is gone is known.
 */
export interface ResourceNames {
  devices: ReadonlyMap<string, string> | null;
  shares: ReadonlyMap<string, string> | null;
  links: ReadonlyMap<string, string> | null;
  tokens: ReadonlyMap<string, string> | null;
}

export const noNames: ResourceNames = { devices: null, shares: null, links: null, tokens: null };

/** A name from a list, a word for what is no longer in it, or one for a list not there yet. */
function nameIn(
  names: ReadonlyMap<string, string> | null,
  id: string,
  words: { unknown: string; gone: string },
): string {
  if (names === null) return words.unknown;
  return names.get(id) ?? words.gone;
}

const formatLabels: Readonly<Record<(typeof exportFormats)[number], string>> = {
  geojson: "GeoJSON",
  gpx: "GPX",
  csv: "CSV",
};

/** A bound of a range: a local day as it is, an instant in the account's zone. */
const bound = (value: string, format: Formatter): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? format.date(value) : format.dateTime(value);

/** "12 Oct 2026 to 19 Oct 2026", "from …", "until …". */
function rangeText(resource: DataAccessResource, format: Formatter): string | null {
  const { from, to } = resource;
  if (from !== undefined && to !== undefined) {
    return `${bound(from, format)} to ${bound(to, format)}`;
  }
  if (from !== undefined) return `From ${bound(from, format)}`;
  if (to !== undefined) return `Until ${bound(to, format)}`;
  return null;
}

/**
 * What a line says about the data, as label and value: which devices (by
 * their names; a device deleted since shows as such), the period, the level,
 * how precisely, which mode … in the order a person would ask. Never a place:
 * the log has none.
 */
export function resourceFacts(
  resource: DataAccessResource,
  names: ResourceNames,
  format: Formatter,
): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => {
    if (value !== null) facts.push({ label, value });
  };
  if (resource.deviceIds !== undefined) {
    const { devices } = names;
    add(
      resource.deviceIds.length === 1 ? "Device" : "Devices",
      devices === null
        ? counted(resource.deviceIds.length, "device", "devices", format)
        : format.list(resource.deviceIds.map((id) => devices.get(id) ?? "a deleted device")),
    );
  }
  add("Period", rangeText(resource, format));
  add("At", resource.at === undefined ? null : format.dateTime(resource.at));
  add("Day", resource.date === undefined ? null : format.date(resource.date));
  add(
    "Hours",
    resource.hours === undefined
      ? null
      : `The last ${format.count(resource.hours)} ${resource.hours === 1 ? "hour" : "hours"}`,
  );
  add("Level", resource.level === undefined ? null : levelLabels[resource.level]);
  add(
    "Precision",
    resource.precision === undefined ? null : precisionInfo[resource.precision].short,
  );
  if (resource.mode !== undefined) {
    add("Mode", resource.mode === null ? "Taken back" : transportModeInfo[resource.mode].label);
  }
  add("Format", resource.format === undefined ? null : formatLabels[resource.format]);
  if (resource.historyDays !== undefined) {
    add(
      "History",
      resource.historyDays === null
        ? "Live only"
        : resource.historyDays === 1
          ? "Last 24 hours"
          : `Last ${format.count(resource.historyDays)} days`,
    );
  }
  add("Stop or move", resource.segmentId === undefined ? null : "One stop or move");
  add(
    "Share",
    resource.shareId === undefined
      ? null
      : nameIn(names.shares, resource.shareId, {
          unknown: "A share",
          gone: "A share that has ended",
        }),
  );
  add(
    "Public link",
    resource.linkId === undefined
      ? null
      : nameIn(names.links, resource.linkId, {
          unknown: "A public link",
          gone: "A link that was removed",
        }),
  );
  add(
    "API token",
    resource.tokenId === undefined
      ? null
      : nameIn(names.tokens, resource.tokenId, {
          unknown: "An API token",
          gone: "A token that was removed",
        }),
  );
  return facts;
}
