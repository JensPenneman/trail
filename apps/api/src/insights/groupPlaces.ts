import { latToTileY, lonToTileX } from "../heatmap/tileMath";
import type { LocalHour } from "./localHours";
import type { PlaceStay } from "./placeStays";

/** The grid places are cells of: Web Mercator tiles at this zoom (about 100 m at 51° N). */
const placeZoom = 18;
/** Places shown; the rest is added up. */
export const placeLimit = 50;

/** `x.y` of the zoom-18 cell a position lies in. */
export function placeCellOf(lat: number, lon: number): string {
  return `${lonToTileX(lon, placeZoom)}.${latToTileY(lat, placeZoom)}`;
}

/** A joined stretch of time at a place: stays of several devices that overlap are one. */
interface Visit {
  fromMs: number;
  toMs: number;
  /** When the earliest of its stays began (it may be before the period). */
  startedMs: number;
}

export interface PlaceGroup {
  /** The cell that claimed the others, or the only cell. */
  key: string;
  /** Every cell folded into the place, the key's first. */
  cells: string[];
  /** `[lon, lat]`, time-weighted, four decimals. */
  centre: [number, number];
  /** The devices that had stays here, sorted. */
  deviceIds: string[];
  /** Joined stretches inside the period, in order. */
  visits: Visit[];
  durationMs: number;
}

interface Cell {
  key: string;
  x: number;
  y: number;
  /** Each stay clipped to the period, with the start it had. */
  parts: Visit[];
  deviceIds: Set<string>;
  durationMs: number;
  lat: number;
  lon: number;
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Overlapping or touching stretches made one, keeping the earliest start. */
function join(parts: readonly Visit[]): Visit[] {
  const joined: Visit[] = [];
  for (const part of [...parts].sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs)) {
    const last = joined.at(-1);
    if (last !== undefined && part.fromMs <= last.toMs) {
      last.toMs = Math.max(last.toMs, part.toMs);
      last.startedMs = Math.min(last.startedMs, part.startedMs);
    } else {
      joined.push({ ...part });
    }
  }
  return joined;
}

/**
 * Stays → places (docs/architecture.md §8.7). Each stay is clipped to the
 * period and goes to the zoom-18 cell of its middle. Cells are then taken by
 * time, most first (ties by key): a cell not yet claimed claims the unclaimed
 * cells among its eight neighbours, so a place is at most 3 × 3 cells (about
 * 290 m at 51° N) and the result does not depend on the order stays came in.
 * A place's time joins its devices (overlapping stretches are one), a visit is
 * a joined stretch whose stay began in the period, and its centre weighs the
 * stays by their time.
 */
export function groupPlaces(
  stays: readonly PlaceStay[],
  period: { startMs: number; endMs: number },
): PlaceGroup[] {
  const cells = new Map<string, Cell>();
  for (const stay of stays) {
    const fromMs = Math.max(stay.startMs, period.startMs);
    const toMs = Math.min(stay.endMs, period.endMs);
    if (toMs <= fromMs) continue;
    const key = placeCellOf(stay.lat, stay.lon);
    let cell = cells.get(key);
    if (cell === undefined) {
      const [x = 0, y = 0] = key.split(".").map(Number);
      cell = { key, x, y, parts: [], deviceIds: new Set(), durationMs: 0, lat: 0, lon: 0 };
      cells.set(key, cell);
    }
    cell.parts.push({ fromMs, toMs, startedMs: stay.startMs });
    cell.deviceIds.add(stay.deviceId);
    // Accumulated as sums of position × time; divided once the group is known.
    cell.durationMs += toMs - fromMs;
    cell.lat += stay.lat * (toMs - fromMs);
    cell.lon += stay.lon * (toMs - fromMs);
  }
  // Join within a cell first: its own time is what the claiming order goes by.
  const order = [...cells.values()].sort(
    (a, b) => b.durationMs - a.durationMs || (a.key < b.key ? -1 : 1),
  );
  const claimed = new Set<string>();
  const groups: PlaceGroup[] = [];
  for (const cell of order) {
    if (claimed.has(cell.key)) continue;
    const members = [cell];
    claimed.add(cell.key);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const neighbour = cells.get(`${cell.x + dx}.${cell.y + dy}`);
        if (neighbour === undefined || claimed.has(neighbour.key)) continue;
        claimed.add(neighbour.key);
        members.push(neighbour);
      }
    }
    const weight = members.reduce((sum, member) => sum + member.durationMs, 0);
    const visits = join(members.flatMap((member) => member.parts));
    groups.push({
      key: cell.key,
      cells: members.map((member) => member.key),
      centre: [
        round4(members.reduce((sum, member) => sum + member.lon, 0) / weight),
        round4(members.reduce((sum, member) => sum + member.lat, 0) / weight),
      ],
      deviceIds: [...new Set(members.flatMap((member) => [...member.deviceIds]))].sort(),
      visits,
      durationMs: visits.reduce((sum, visit) => sum + (visit.toMs - visit.fromMs), 0),
    });
  }
  return groups.sort(
    (a, b) => b.durationMs - a.durationMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/** The place a key's cell belongs to (folded or not), or null. */
export function placeOf(groups: readonly PlaceGroup[], key: string): PlaceGroup | null {
  return groups.find((group) => group.cells.includes(key)) ?? null;
}

/** One local day: `[start, end)` in epoch ms. */
export interface LocalDay {
  date: string;
  start: number;
  end: number;
}

/** The period's local days, from its hours (a day of 23 or 25 hours is one). */
export function localDaysOf(hours: readonly LocalHour[]): LocalDay[] {
  const days: LocalDay[] = [];
  for (const hour of hours) {
    const last = days.at(-1);
    if (last !== undefined && last.date === hour.date) last.end = hour.end;
    else days.push({ date: hour.date, start: hour.start, end: hour.end });
  }
  return days;
}

export interface DayRow {
  date: string;
  durationMs: number;
  /** Visits that began that day. */
  visits: number;
  firstMs: number;
  lastMs: number;
}

/**
 * A place's time split at local midnight: per day with time there, the time,
 * the visits that began that day and the first and last moment inside it.
 * Oldest first.
 */
export function placeDays(group: PlaceGroup, days: readonly LocalDay[]): DayRow[] {
  const rows = new Map<string, DayRow>();
  const dayAt = (instant: number): number => {
    let low = 0;
    let high = days.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((days[middle]?.start ?? 0) <= instant) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const rowOf = (day: LocalDay): DayRow => {
    let row = rows.get(day.date);
    if (row === undefined) {
      row = {
        date: day.date,
        durationMs: 0,
        visits: 0,
        firstMs: Number.POSITIVE_INFINITY,
        lastMs: 0,
      };
      rows.set(day.date, row);
    }
    return row;
  };
  for (const visit of group.visits) {
    for (let index = dayAt(visit.fromMs); index < days.length; index += 1) {
      const day = days[index];
      if (day === undefined || day.start >= visit.toMs) break;
      const from = Math.max(visit.fromMs, day.start);
      const to = Math.min(visit.toMs, day.end);
      if (to <= from) continue;
      const row = rowOf(day);
      row.durationMs += to - from;
      row.firstMs = Math.min(row.firstMs, from);
      row.lastMs = Math.max(row.lastMs, to);
    }
    // A visit counts on the day its stay began, when that is inside the period.
    const began = days[dayAt(visit.startedMs)];
    if (began !== undefined && visit.startedMs >= began.start && visit.startedMs < began.end) {
      rowOf(began).visits += 1;
    }
  }
  return [...rows.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
