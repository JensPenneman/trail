import type { OutgoingShare } from "@trail/contracts/share";

/** The recipient's name once they have an account, else the address shared with. */
export const recipientName = (share: OutgoingShare): string =>
  share.recipient.displayName ?? share.recipient.email;
