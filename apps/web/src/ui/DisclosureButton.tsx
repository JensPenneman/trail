import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { Disclosure } from "./useDisclosure";
import "./DisclosureButton.css";

interface DisclosureButtonProps {
  disclosure: Disclosure;
  /** The ids of what says whose it is (a card's name), as the button's description. */
  describedBy?: string;
  children: ReactNode;
}

/**
 * The button of a disclosure: it says whether what it controls is open
 * (`aria-expanded`), and that content follows it in the reading and tab
 * order (`DisclosureContent`).
 */
export function DisclosureButton({ disclosure, describedBy, children }: DisclosureButtonProps) {
  return (
    <button
      type="button"
      className="button button--ghost disclosure-button"
      aria-expanded={disclosure.open}
      aria-controls={disclosure.contentId}
      aria-describedby={describedBy}
      onClick={disclosure.toggle}
    >
      <span>{children}</span>
      <Icon name="chevronDown" className="disclosure-button__chevron" />
    </button>
  );
}
