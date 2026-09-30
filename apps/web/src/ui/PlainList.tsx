import type { ReactNode } from "react";

interface PlainListProps {
  ordered?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A list without bullets that is still announced as a list: Safari's
 * VoiceOver drops list semantics from `list-style: none` unless the role is
 * stated explicitly.
 */
export function PlainList({ ordered = false, className, children }: PlainListProps) {
  const List = ordered ? "ol" : "ul";
  return (
    <List role="list" className={className}>
      {children}
    </List>
  );
}
