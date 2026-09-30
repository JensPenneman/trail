import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useToday } from "../../time/useToday";
import type { HistorySelection } from "./HistorySelection";
import { parseHistorySelection } from "./parseHistorySelection";

/** The selection lives in the URL, so it survives reloads, can be shared and works with Back. */
export function useHistorySelection(): {
  selection: HistorySelection;
  today: string;
  showDay: (date: string) => void;
  showRange: (from: string, to: string) => void;
  showDevices: (deviceIds: readonly string[] | null) => void;
} {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const selection = useMemo(() => parseHistorySelection(params, today), [params, today]);

  const update = useCallback(
    (change: (next: URLSearchParams) => void) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          change(next);
          return next;
        },
        { replace: false, preventScrollReset: true },
      );
    },
    [setParams],
  );

  const showDay = useCallback(
    (date: string) =>
      update((next) => {
        next.delete("from");
        next.delete("to");
        if (date === today) next.delete("date");
        else next.set("date", date);
      }),
    [update, today],
  );
  const showRange = useCallback(
    (from: string, to: string) =>
      update((next) => {
        next.delete("date");
        next.set("from", from);
        next.set("to", to);
      }),
    [update],
  );
  const showDevices = useCallback(
    (deviceIds: readonly string[] | null) =>
      update((next) => {
        if (deviceIds === null) next.delete("devices");
        else next.set("devices", deviceIds.join(","));
      }),
    [update],
  );

  return { selection, today, showDay, showRange, showDevices };
}
