import { storableText } from "./storableText";
import { redactSecrets } from "./withoutSecrets";

/** How much of a body it cannot read the dead letter keeps. */
const previewLength = 2000;

const jsonEscape = /\\u([0-9A-Fa-f]{4})/g;

/**
 * The start of a body Trail cannot read, as the dead letter keeps it: the
 * body as it came, unless it holds a token. To look for one, JSON's `\uXXXX`
 * escapes are decoded, as `JSON.parse` would have decoded them, so that no
 * spelling of a token gets past `redactSecrets`; a body with one is kept
 * decoded and redacted. Redacted whole and only then cut — a token cut in half
 * would no longer be recognised — and the cut, which may split a surrogate
 * pair, made storable.
 */
export function previewText(text: string): string {
  const unescaped = text.replace(jsonEscape, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  const redacted = redactSecrets(unescaped);
  return storableText((redacted === unescaped ? text : redacted).slice(0, previewLength));
}
