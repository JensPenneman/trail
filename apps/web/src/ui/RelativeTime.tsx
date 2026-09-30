import { useFormatter } from "../format/useFormatter";
import { useNow } from "../time/useNow";

interface RelativeTimeProps {
  /** ISO instant. */
  value: string;
  /** How often to re-render; seconds matter for "last upload", not for "created". */
  tickMs?: number;
}

/** "12 sec ago" that keeps counting, with the exact local time as its machine-readable value and tooltip. */
export function RelativeTime({ value, tickMs = 1000 }: RelativeTimeProps) {
  const format = useFormatter();
  const now = useNow(tickMs);
  return (
    <time dateTime={value} title={format.dateTime(value)}>
      {format.relative(value, now)}
    </time>
  );
}
