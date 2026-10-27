import { storableText } from "./storableText";
import { redactSecrets } from "./withoutSecrets";

/** How much of a body it cannot read the dead letter keeps. */
const previewLength = 2000;

const jsonEscape = /\\u([0-9A-Fa-f]{4})/g;

/**
 * The start of a body Trail cannot read, as the dead letter keeps it. JSON's
 * `\uXXXX` escapes are decoded first, as `JSON.parse` would have decoded them,
 * so that no spelling of a token gets past `redactSecrets`; the text is
 * redacted whole and only then cut — a token cut in half would no longer be
 * recognised — and the cut, which may split a surrogate pair, made storable.
 */
export function previewText(text: string): string {
  const unescaped = text.replace(jsonEscape, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return storableText(redactSecrets(unescaped).slice(0, previewLength));
}
