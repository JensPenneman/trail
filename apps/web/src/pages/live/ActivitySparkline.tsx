import { useId, useMemo, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { Icon } from "../../ui/Icon";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import type { ActivitySlot } from "./activitySlots";
import "./ActivitySparkline.css";

interface ActivitySparklineProps {
  slots: readonly ActivitySlot[];
  /** Palette slot of the device, for the bar colour. */
  colorSlot: number;
  deviceName: string;
}

const width = 480;
const height = 56;
const barAreaHeight = 44;
const rugY = 50;

/**
 * Points recorded per hour over the last two days, with a tick under every
 * hour in which the phone uploaded: the at-a-glance proof that data keeps
 * arriving. The summary is the image's text alternative; the hourly numbers
 * are available as a table.
 */
export function ActivitySparkline({ slots, colorSlot, deviceName }: ActivitySparklineProps) {
  const format = useFormatter();
  const tableId = useId();
  const scrollable = useScrollableFocus();
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...slots.map((slot) => slot.recorded));
  const slotWidth = width / Math.max(1, slots.length);
  const barWidth = Math.max(1, Math.min(slotWidth - 2, 24));

  const summary = useMemo(() => {
    const points = slots.reduce((sum, slot) => sum + slot.recorded, 0);
    const uploads = slots.reduce((sum, slot) => sum + slot.uploads, 0);
    const activeHours = slots.filter((slot) => slot.recorded > 0 || slot.uploads > 0).length;
    return `${deviceName}, last ${slots.length} hours: ${format.count(points)} points in ${activeHours} of ${slots.length} hours, ${format.count(uploads)} uploads.`;
  }, [slots, deviceName, format]);

  const hoveredSlot = hovered === null ? undefined : slots[hovered];
  // Consecutive hours with uploads merge into one bar, so a gap in uploading stands out.
  const uploadRuns = useMemo(() => {
    const runs: { from: number; to: number }[] = [];
    for (const [index, slot] of slots.entries()) {
      if (slot.uploads === 0) continue;
      const last = runs[runs.length - 1];
      if (last !== undefined && last.to === index - 1) last.to = index;
      else runs.push({ from: index, to: index });
    }
    return runs;
  }, [slots]);
  const busyHours = slots.filter((slot) => slot.recorded > 0 || slot.uploads > 0);

  return (
    <figure className={`sparkline device-color-${colorSlot}`}>
      <div className="sparkline__plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const index = Math.floor(((event.clientX - box.left) / box.width) * slots.length);
            setHovered(index >= 0 && index < slots.length ? index : null);
          }}
          onPointerLeave={() => setHovered(null)}
        >
          <line
            className="sparkline__baseline"
            x1="0"
            x2={width}
            y1={barAreaHeight}
            y2={barAreaHeight}
          />
          {slots.map((slot, index) => {
            const x = index * slotWidth + (slotWidth - barWidth) / 2;
            const barHeight =
              slot.recorded === 0 ? 0 : Math.max(2, (slot.recorded / max) * (barAreaHeight - 2));
            return (
              <g
                key={slot.start}
                className={index === hovered ? "sparkline__slot is-hovered" : "sparkline__slot"}
              >
                {barHeight > 0 ? (
                  <rect
                    className="sparkline__bar"
                    x={x}
                    y={barAreaHeight - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(2, barWidth / 2)}
                  />
                ) : null}
                {slot.uploads > 0 ? (
                  <rect
                    className="sparkline__upload"
                    x={x}
                    y={rugY}
                    width={barWidth}
                    height={4}
                    rx={1}
                  />
                ) : null}
              </g>
            );
          })}
          {uploadRuns.map((run) => (
            <rect
              key={run.from}
              className="sparkline__upload"
              x={run.from * slotWidth + 1}
              y={rugY}
              width={(run.to - run.from + 1) * slotWidth - 2}
              height={3}
              rx={1.5}
            />
          ))}
        </svg>
        {hoveredSlot === undefined ? null : (
          <p className="sparkline__tooltip" aria-hidden="true">
            {format.time(hoveredSlot.start)}–{format.time(hoveredSlot.start + 3_600_000)} ·{" "}
            {format.count(hoveredSlot.recorded)} points · {format.count(hoveredSlot.uploads)}{" "}
            uploads
          </p>
        )}
      </div>
      <figcaption className="sparkline__axis" aria-hidden="true">
        <span>{slots.length} h ago</span>
        <span className="sparkline__key">
          <span className="sparkline__key-bar" /> points
          <span className="sparkline__key-line" /> uploads
        </span>
        <span>now</span>
      </figcaption>
      <details className="sparkline__details disclosure">
        <summary>
          Hourly numbers
          <Icon name="chevronDown" className="disclosure__chevron" />
        </summary>
        {busyHours.length === 0 ? (
          <p className="muted">Nothing recorded or uploaded in this period.</p>
        ) : (
          <section
            className="table-scroll"
            aria-label={`Hourly numbers of ${deviceName}`}
            ref={scrollable}
          >
            <table className="table" id={tableId}>
              <thead>
                <tr>
                  <th scope="col">Hour</th>
                  <th scope="col" className="table__number">
                    Points
                  </th>
                  <th scope="col" className="table__number">
                    Uploads
                  </th>
                </tr>
              </thead>
              <tbody>
                {busyHours.map((slot) => (
                  <tr key={slot.start}>
                    <td>{format.dayTime(slot.start)}</td>
                    <td className="table__number">{format.count(slot.recorded)}</td>
                    <td className="table__number">{format.count(slot.uploads)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </details>
    </figure>
  );
}
