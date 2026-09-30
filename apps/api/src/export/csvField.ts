/* Spreadsheet apps execute cells that start like a formula; a Wi-Fi name is
 * chosen by whoever runs the access point, so text cells are defused. */
const formulaStart = /^[=+\-@\t\r]/;

/** One RFC 4180 field. Numbers are written as-is, text is quoted when needed. */
export function csvField(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = formulaStart.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
