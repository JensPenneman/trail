import type { Person } from "@trail/contracts/person";
import { useContext } from "react";
import { LiveStoreContext } from "../../live/LiveStoreContext";
import { useLiveState } from "../../live/useLiveState";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";

/** "Ana shares…", "Ana and Bob share…", "Ana, Bob and 3 others share…" their location with you. */
export function confirmationText(names: readonly string[]): string {
  const [first, second, third] = names;
  if (names.length === 1) return `${first} shares their location with you`;
  if (names.length === 2) return `${first} and ${second} share their location with you`;
  if (names.length === 3) return `${first}, ${second} and ${third} share their location with you`;
  return `${first}, ${second} and ${names.length - 2} others share their location with you`;
}

/**
 * People who started sharing while the page was open, folded into one quiet
 * status row with one Dismiss, however many they are.
 */
export function ShareConfirmations({ people }: { people: readonly Person[] }) {
  const { shareNotices } = useLiveState();
  const store = useContext(LiveStoreContext);
  // In the list's order, so the names read as the people are listed.
  const announced = people.flatMap((person) =>
    shareNotices.some((entry) => entry.shareId === person.share.id)
      ? [{ shareId: person.share.id, name: person.displayName }]
      : [],
  );
  if (announced.length === 0) return null;
  return (
    <Notice
      tone="success"
      role="status"
      title={confirmationText(announced.map((entry) => entry.name))}
      action={
        <Button
          variant="ghost"
          onClick={() => {
            for (const entry of announced) store?.dismissShareNotice(entry.shareId);
          }}
        >
          Dismiss
        </Button>
      }
    />
  );
}
