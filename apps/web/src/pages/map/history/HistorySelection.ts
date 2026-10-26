/** What the History page shows, as encoded in its URL. */
export interface HistorySelection {
  mode: "day" | "range";
  /** First local date shown. */
  from: string;
  /** Last local date shown (equal to `from` in day mode). */
  to: string;
  /** Selected devices, or null for all. */
  deviceIds: readonly string[] | null;
}
