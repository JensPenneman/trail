/** The range of a history query: `[from, to)` instants and the devices asked for (all when absent). */
export interface HistoryRange {
  from: string;
  to: string;
  deviceIds?: readonly string[] | undefined;
}
