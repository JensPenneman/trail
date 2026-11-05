/**
 * Which folded groups of a person's page are open: kept by the page, so that a
 * level of the page (Me's devices) and back finds them as they were left.
 */
export interface Groups {
  isOpen: (title: string) => boolean;
  set: (title: string, open: boolean) => void;
}
