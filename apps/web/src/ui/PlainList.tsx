import type { ReactNode } from "react";

interface PlainListProps {
  ordered?: boolean;
  className?: string;
  /** An accessible name, for a list that has no heading of its own. */
  label?: string;
  /** The id of the heading that names the list. */
  labelledBy?: string;
  children: ReactNode;
}

/**
 * A list without bullets that is still announced as a list: Safari's
 * VoiceOver drops list semantics from `list-style: none` unless the role is
 * stated explicitly.
 */
export function PlainList({
  ordered = false,
  className,
  label,
  labelledBy,
  children,
}: PlainListProps) {
  const List = ordered ? "ol" : "ul";
  return (
    <List role="list" className={className} aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </List>
  );
}
