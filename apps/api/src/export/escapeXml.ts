const entities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/* XML 1.0 forbids control characters other than tab, line feed and carriage return. */
const allowedControls = new Set([0x09, 0x0a, 0x0d]);
const isAllowed = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code >= 0x20 || allowedControls.has(code);
};

/** Text or attribute value for XML. */
export function escapeXml(value: string): string {
  return [...value]
    .filter(isAllowed)
    .join("")
    .replace(/[&<>"']/g, (character) => entities[character] ?? character);
}
