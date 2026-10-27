import type { ReactNode } from "react";
import type { Disclosure } from "./useDisclosure";

interface DisclosureContentProps {
  disclosure: Disclosure;
  className?: string;
  children: ReactNode;
}

/**
 * What a disclosure shows: there for its button to point at, and only
 * rendered while open — a closed one asks for nothing and holds no tab stops.
 */
export function DisclosureContent({ disclosure, className, children }: DisclosureContentProps) {
  return (
    <div id={disclosure.contentId} className={className} hidden={!disclosure.open}>
      {disclosure.open ? children : null}
    </div>
  );
}
