import { personInitials } from "./personInitials";
import "./PersonAvatar.css";

interface PersonAvatarProps {
  name: string;
  /** Palette slot (`assignPersonColors`), or `me` for the signed-in person (the accent colour). */
  slot: number | "me";
  size?: "s" | "m";
}

/** A person's initials in a ring of their colour; the name always stands next to it. */
export function PersonAvatar({ name, slot, size = "m" }: PersonAvatarProps) {
  const color = slot === "me" ? "person-avatar--me" : `person-color-${slot}`;
  return (
    <span className={`person-avatar person-avatar--${size} ${color}`} aria-hidden="true">
      {personInitials(name)}
    </span>
  );
}
