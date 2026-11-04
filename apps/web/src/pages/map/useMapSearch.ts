import { startTransition, useCallback, useMemo, useOptimistic } from "react";
import { useSearchParams } from "react-router";
import { useToday } from "../../time/useToday";
import { withDay, withDevices, withPerson, withRange, withView } from "./mapSearchUpdates";
import type { MapView } from "./mapViews";
import { type MapSearch, parseMapSearch } from "./parseMapSearch";

export interface MapSearchControls {
  search: MapSearch;
  today: string;
  setView: (view: MapView) => void;
  /**
   * Writes the selection an older link implies (`?segment=`, `?devices=`) into
   * the address, in place of its entry, so that closing a move or ticking all
   * devices again keeps the detail. Does nothing while a choice is on its way.
   */
  adoptPerson: (person: string) => void;
  /**
   * Leaves the detail of `person` for the list, in place of its entry — if the
   * address still names them when this runs (hiding someone answers late).
   */
  leavePerson: (person: string) => void;
  setDevices: (deviceIds: readonly string[] | null) => void;
  showDay: (date: string) => void;
  /** History on a day, from another view: one step of the history for both. */
  showHistoryDay: (date: string) => void;
  showRange: (from: string, to: string) => void;
}

/**
 * The People page's state lives in its URL, so it survives reloads, can be
 * shared and works with Back: every change is a history entry of its own (the
 * level and the map style replace theirs, see useTrackLevel and useMapStyle).
 */
export function useMapSearch(): MapSearchControls {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const parsed = useMemo(() => parseMapSearch(params, today), [params, today]);
  // The router applies a new URL in a transition; until then the controls show the choice made
  // (a checkbox bound to the URL would otherwise flick back for a moment).
  const [view, showView] = useOptimistic(parsed.view);
  const [chosen, showChosen] = useOptimistic({ person: parsed.person, devices: parsed.devices });
  const search = useMemo(() => ({ ...parsed, ...chosen, view }), [parsed, chosen, view]);

  const update = useCallback(
    (change: (current: URLSearchParams) => URLSearchParams, replace = false) =>
      setParams((current) => change(current), { preventScrollReset: true, replace }),
    [setParams],
  );
  const setView = useCallback(
    (next: MapView) =>
      startTransition(() => {
        showView(next);
        // Another view is another screen: on phones the page starts from the top.
        setParams((current) => withView(current, next));
      }),
    [setParams, showView],
  );
  const settled = chosen.person === parsed.person && chosen.devices === parsed.devices;
  const leavePerson = useCallback(
    (person: string) =>
      update(
        (current) => (current.get("person") === person ? withPerson(current, null) : current),
        true,
      ),
    [update],
  );
  const adoptPerson = useCallback(
    (person: string) => {
      if (!settled || params.get("person") === person) return;
      update((current) => {
        const next = new URLSearchParams(current);
        next.delete("people");
        next.set("person", person);
        return next;
      }, true);
    },
    [params, update, settled],
  );
  const setDevices = useCallback(
    (deviceIds: readonly string[] | null) =>
      startTransition(() => {
        showChosen((current) => ({ ...current, devices: deviceIds }));
        update((current) => withDevices(current, deviceIds));
      }),
    [update, showChosen],
  );
  const showDay = useCallback(
    (date: string) => update((current) => withDay(current, date, today)),
    [update, today],
  );
  const showHistoryDay = useCallback(
    (date: string) =>
      startTransition(() => {
        showView("history");
        update((current) => withView(withDay(current, date, today), "history"));
      }),
    [update, today, showView],
  );
  const showRange = useCallback(
    (from: string, to: string) => update((current) => withRange(current, from, to)),
    [update],
  );
  return {
    search,
    today,
    setView,
    adoptPerson,
    leavePerson,
    setDevices,
    showDay,
    showHistoryDay,
    showRange,
  };
}
