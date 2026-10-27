import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { useScrollableFocus } from "../ui/useScrollableFocus";
import "./ChartTable.css";

interface ChartTableProps {
  /** The disclosure's summary: "Show the numbers". */
  label: string;
  /** Names the table and its scrolling box. */
  caption?: string;
  /** An empty label leaves the corner cell empty. */
  columns: readonly { key: string; label: string; numeric?: boolean }[];
  /** One cell per column; the first is the row's header. */
  rows: readonly { key: string; cells: readonly ReactNode[] }[];
}

/**
 * The numbers behind a chart as a table, folded away in a disclosure: what
 * the chart shows in shapes and colour, cell by cell in text. A wide table
 * scrolls sideways inside its box (a tab stop while it does).
 */
export function ChartTable({ label, caption, columns, rows }: ChartTableProps) {
  const scrollable = useScrollableFocus();
  return (
    <details className="disclosure chart-table">
      <summary>
        {label}
        <Icon name="chevronDown" className="disclosure__chevron" />
      </summary>
      <section className="table-scroll" aria-label={caption ?? label} ref={scrollable}>
        <table className="table">
          {caption === undefined ? null : <caption>{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) =>
                column.label === "" ? (
                  <td key={column.key} />
                ) : (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric === true ? "table__number" : undefined}
                  >
                    {column.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {columns.map((column, index) => {
                  const className = column.numeric === true ? "table__number" : undefined;
                  return index === 0 ? (
                    <th key={column.key} scope="row" className={className}>
                      {row.cells[index]}
                    </th>
                  ) : (
                    <td key={column.key} className={className}>
                      {row.cells[index]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </details>
  );
}
