import { personInitials } from "./personInitials";
import "./PersonAvatar.css";

interface PersonAvatarProps {
  name: string;
  /** Palette slot (`assignPersonColors`). */
  slot: number;
  size?: "s" | "m";
}

/** A person's initials in a ring of their colour; the name always stands next to it. */
export function PersonAvatar({ name, slot, size = "m" }: PersonAvatarProps) {
  return (
    <span
      className={`person-avatar person-avatar--${size} person-color-${slot}`}
      aria-hidden="true"
    >
      {personInitials(name)}
    </span>
  );
}
