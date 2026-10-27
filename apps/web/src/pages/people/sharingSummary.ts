import type { OutgoingShare } from "@trail/contracts/share";

/**
 * The People page's line about one's own sharing (managed in Settings ›
 * Sharing): with how many people, and how many of them signed up and wait
 * for a confirmation that they are the person meant.
 */
export function sharingSummary(
  shares: readonly OutgoingShare[],
  count: (value: number) => string,
): { line: string; toConfirm: string | null } {
  const joined = shares.filter((share) => share.status === "joined").length;
  return {
    line:
      shares.length === 0
        ? "You share with nobody"
        : `You share with ${count(shares.length)} ${shares.length === 1 ? "person" : "people"}`,
    toConfirm:
      joined === 0
        ? null
        : `${count(joined)} ${joined === 1 ? "waits" : "wait"} for you to confirm`,
  };
}
