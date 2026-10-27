import type { OutgoingShare } from "@trail/contracts/share";

/** Where a share stands, from the owner's side. */
export const shareStatusLabels: Readonly<Record<OutgoingShare["status"], string>> = {
  pending: "Waiting for them",
  joined: "Joined — confirm?",
  active: "Sees you",
  hidden: "Hid you",
};
