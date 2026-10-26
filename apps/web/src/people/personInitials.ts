/** "AB" for "Ana Bell", "J" for "jens"; letters of any script, never more than two. */
export function personInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/u)
    .filter((word) => word.length > 0);
  const letters = words.map((word) => [...word][0] ?? "");
  const first = letters[0] ?? "";
  const last = letters.length > 1 ? (letters.at(-1) ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase() || "?";
}
