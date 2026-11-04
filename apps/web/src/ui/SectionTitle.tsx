import { createContext, type ReactNode, use } from "react";

/** The level of the section titles below: 2 on a page of their own, 3 under a detail's name. */
export const SectionLevel = createContext<2 | 3>(2);

/** A section's heading, one level under whatever it sits in (see `SectionLevel`). */
export function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  const Heading = use(SectionLevel) === 2 ? "h2" : "h3";
  return (
    <Heading className="section__title" id={id}>
      {children}
    </Heading>
  );
}
