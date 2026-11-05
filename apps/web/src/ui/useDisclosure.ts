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
 * first, unless told otherwise.
 */
export function useDisclosure(initiallyOpen = false): Disclosure {
  const [open, setOpen] = useState(initiallyOpen);
  const contentId = useId();
  const toggle = useCallback(() => setOpen((current) => !current), []);
  return { open, toggle, contentId };
}
