/**
 * SVG path data for a QR matrix: one rectangle per horizontal run of dark
 * modules, so a large code stays a single small path instead of thousands of
 * elements. Coordinates are in modules, offset by the quiet zone.
 */
export function qrPath(modules: readonly (readonly boolean[])[], offset: number): string {
  const commands: string[] = [];
  for (const [row, cells] of modules.entries()) {
    let column = 0;
    while (column < cells.length) {
      if (cells[column] !== true) {
        column += 1;
        continue;
      }
      const start = column;
      while (cells[column] === true) column += 1;
      commands.push(`M${start + offset} ${row + offset}h${column - start}v1h-${column - start}z`);
    }
  }
  return commands.join("");
}
