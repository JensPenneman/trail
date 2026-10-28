const hexValue = (code: number): number =>
  code >= 48 && code <= 57
    ? code - 48
    : code >= 97 && code <= 102
      ? code - 87
      : code >= 65 && code <= 70
        ? code - 55
        : -1;

/**
 * A key or value of an OPL line as text: osmium writes a space, `,`, `=`,
 * `@`, `%` and the characters beyond U+05FF as `%<hex>%`. Null when an escape
 * is broken or would give a character Postgres cannot store (U+0000, a lone
 * surrogate).
 */
export function decodeOplText(text: string): string | null {
  if (!text.includes("%")) return text.includes("\u0000") ? null : text;
  let decoded = "";
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("%", index);
    if (open === -1) {
      decoded += text.slice(index);
      break;
    }
    decoded += text.slice(index, open);
    const close = text.indexOf("%", open + 1);
    if (close === -1 || close === open + 1 || close - open > 7) return null;
    let code = 0;
    for (let digit = open + 1; digit < close; digit += 1) {
      const value = hexValue(text.charCodeAt(digit));
      if (value < 0) return null;
      code = code * 16 + value;
    }
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return null;
    decoded += String.fromCodePoint(code);
    index = close + 1;
  }
  return decoded.includes("\u0000") ? null : decoded;
}
