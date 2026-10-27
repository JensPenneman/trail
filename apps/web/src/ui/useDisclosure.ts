import { useCallback, useId, useState } from "react";

/** A disclosure's state, and the ids that tie its button to what it shows. */
export interface Disclosure {
  open: boolean;
  toggle: () => void;
  /** The id of the element the button shows and hides (`aria-controls`). */
  contentId: string;
}

/**
 * The disclosure pattern without its markup, for a button that sits apart
 * from what it opens (a card's row of actions, its details below): closed at
 * first.
 */
export function useDisclosure(): Disclosure {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const toggle = useCallback(() => setOpen((current) => !current), []);
  return { open, toggle, contentId };
}
