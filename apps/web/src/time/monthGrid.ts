const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The weeks of a month for a calendar: rows of seven local dates `YYYY-MM-DD`,
 * with null for the cells before the 1st and after the last day.
 */
export function monthGrid(year: number, month: number, firstDay: number): (string | null)[][] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay: 0 = Sunday … 6 = Saturday → ISO 1 = Monday … 7 = Sunday.
  const isoWeekdayOfFirst = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() || 7;
  const leading = (isoWeekdayOfFirst - firstDay + 7) % 7;
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}
