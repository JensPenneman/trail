/**
 * Text as Postgres stores it: `text` and `jsonb` refuse NUL characters and lone
 * UTF-16 surrogates, and a single one anywhere in a batch (a Wi-Fi name is
 * enough) would fail the whole upload, which Overland then retries forever.
 * NULs are dropped, lone surrogates become U+FFFD.
 */
export function storableText(value: string): string {
  return value.replaceAll("\u0000", "").toWellFormed();
}
