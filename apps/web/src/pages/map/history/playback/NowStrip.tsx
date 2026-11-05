import { useFormatter } from "../../../../format/useFormatter";
import { DeviceSwatch } from "../../../../ui/DeviceSwatch";
import { PlainList } from "../../../../ui/PlainList";
import { movementOf } from "./playbackModel";
import "./NowStrip.css";

/** One drawn device at the moment shown. */
export interface NowEntry {
  id: string;
  name: string;
  /** Palette slot and palette of its colour. */
  slot: number;
  palette: "device" | "person";
  /** What the timeline says it was doing (oneself); null where it has none. */
  mode: string | null;
  /** m/s at that moment; null when unknown. */
  speed: number | null;
  /** Where it was; null when nothing was recorded then. */
  position: { lat: number; lon: number } | null;
}

/**
 * What each drawn device was doing at the moment shown (region "At this
 * moment"), in words, in place of the sidebar while it plays: its colour and
 * name, its mode (for someone else "Moving" or "Still", from the speed), its
 * speed and where it was, or that nothing was recorded then.
 */
export function NowStrip({ entries }: { entries: readonly NowEntry[] }) {
  const format = useFormatter();
  return (
    <section className="now-strip" aria-label="At this moment">
      <PlainList className="now-strip__list">
        {entries.map((entry) => {
          const doing = entry.mode ?? movementOf(entry.speed);
          return (
            <li key={entry.id} className="now-strip__item">
              <DeviceSwatch slot={entry.slot} palette={entry.palette} />
              <span className="now-strip__name">{entry.name}</span>
              {entry.position === null ? (
                <span className="now-strip__none">no position recorded then</span>
              ) : (
                <span className="now-strip__facts">
                  {[
                    doing,
                    entry.speed === null ? null : format.speed(entry.speed),
                    format.coordinates(entry.position.lat, entry.position.lon),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              )}
            </li>
          );
        })}
      </PlainList>
    </section>
  );
}
