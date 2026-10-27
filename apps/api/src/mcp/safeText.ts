import { mcpTextLength } from "@trail/contracts/mcp";

/*
 * Control characters (C0, DEL, C1), format characters (zero-width spaces and
 * joiners, bidirectional overrides and isolates, the byte order mark, the
 * invisible tag characters of U+E0000) and the line and paragraph separators:
 * none belongs in a name, and each can hide text from the person reading a
 * transcript or fake structure (new lines, reordered text) for the model.
 */
const hidden = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const spaces = /\s+/gu;

/**
 * A string that someone typed — a device's name, a person's display name, a
 * share's label — made fit to hand to an agent's model as plain data:
 * invisible and control characters become spaces, runs of white space one
 * space, and the result is cut to `maxLength` code points (with an ellipsis).
 * It still reaches the model, so it only ever travels in a data field, never
 * in instructions or descriptions (docs/mcp.md, threat model).
 */
export function safeText(value: string, maxLength: number = mcpTextLength): string {
  const visible = value.toWellFormed().replace(hidden, " ").replace(spaces, " ").trim();
  const characters = [...visible];
  if (characters.length <= maxLength) return visible;
  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}
