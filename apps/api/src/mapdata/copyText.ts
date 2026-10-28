/**
 * A value as COPY's text format reads it: backslash, tab, line feed and
 * carriage return escaped (the parsers keep U+0000 out, which Postgres
 * cannot store).
 */
export const copyField = (value: string): string =>
  /[\\\t\n\r]/.test(value)
    ? value.replace(/[\\\t\n\r]/g, (character) =>
        character === "\\"
          ? "\\\\"
          : character === "\t"
            ? "\\t"
            : character === "\n"
              ? "\\n"
              : "\\r",
      )
    : value;
