import { createContext, type ReactNode, use } from "react";

/**
 * The level of the section titles below: 2 on a page of their own, 3 under a
 * detail's name, 4 inside a folded group of it (whose own heading is an h3).
 */
export const SectionLevel = createContext<2 | 3 | 4>(2);

/** A section's heading, one level under whatever it sits in (see `SectionLevel`). */
export function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  const Heading = `h${use(SectionLevel)}` as "h2" | "h3" | "h4";
  return (
    <Heading className="section__title" id={id}>
      {children}
    </Heading>
  );
}
