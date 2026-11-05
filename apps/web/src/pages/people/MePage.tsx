import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { type ReactNode, useId } from "react";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { PersonSummary } from "../../people/PersonSummary";
import { SettingsDisclosureGroup } from "../../settings/SettingsDisclosureGroup";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import "../../ui/BackLink.css";
import { Icon } from "../../ui/Icon";
import { SectionLevel } from "../../ui/SectionTitle";
import type { MapViewContent } from "../map/MapViewContent";
import type { Groups } from "./groupState";
import { MeDetails } from "./MeDetails";
import { sharingSummary } from "./sharingSummary";
import { useMeSummary } from "./useMeSummary";
import type { SharingActions } from "./useSharingActions";
import "./PersonPage.css";

interface MePageProps {
  /** The root: the page's address without the selection. */
  backTo: string;
  /** The level that lists one's devices. */
  devicesTo: string;
  name: string;
  devices: UseQueryResult<DeviceSummary[]>;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  content: MapViewContent;
  sharing: SharingActions;
  groups: Groups;
  /** History's slider on phones: right under the header, so the sheet's peek does not hold it. */
  foot: ReactNode;
}

/**
 * Me's page, in place of the root: how fresh one's position is, what one is
 * doing and with how many devices; the setup hint; the timeline of the view's
 * day (open); the view's other group (History's summary, visits and trips, or
 * Heat's totals and busiest places), folded; then the rows to one's devices (a
 * level of this page) and to Settings › Sharing. A group stays as one left it
 * while the view changes.
 */
export function MePage({
  backTo,
  devicesTo,
  name,
  devices,
  now,
  thresholds,
  content,
  sharing,
  groups,
  foot,
}: MePageProps) {
  const titleId = useId();
  const format = useFormatter();
  const summary = useMeSummary(devices, now, thresholds);
  const group = (title: string) => ({
    open: groups.isOpen(title),
    onOpenChange: (open: boolean) => groups.set(title, open),
  });
  const timelineGroup = (
    <SettingsDisclosureGroup title="Timeline" {...group("Timeline")}>
      {content.timeline}
    </SettingsDisclosureGroup>
  );
  const count = devices.data?.length;
  const shares = sharing.shares.data;
  const sharesLine = shares === undefined ? undefined : sharingSummary(shares, format.count);
  // The row says what it knows: the line, or that it is loading, or why it could not be.
  const sharingDetail =
    sharesLine !== undefined
      ? `${sharesLine.line}${sharesLine.toConfirm === null ? "" : ` · ${sharesLine.toConfirm}`}`
      : sharing.shares.isError
        ? "Could not be loaded"
        : "Loading…";

  return (
    <section className="person-panel" aria-labelledby={titleId}>
      <SectionLevel value={3}>
        <Link to={backTo} className="back-link" preventScrollReset>
          <Icon name="chevronLeft" className="back-link__icon" />
          <span className="back-link__label">
            <span className="visually-hidden">Back to</span> People
          </span>
        </Link>
        <PersonSummary
          title="Me"
          titleId={titleId}
          level={2}
          avatar={{ name, slot: "me" }}
          freshness={summary.freshness}
          doing={summary.doing}
          {...(count === undefined || count === 0
            ? {}
            : { detail: `${format.count(count)} ${count === 1 ? "device" : "devices"}` })}
        />
        {foot}
        <MeDetails devices={devices} summary={summary} />

        {content.timeline === null ? null : content.timelineLabel === "" ? (
          timelineGroup
        ) : (
          <section aria-label={content.timelineLabel}>{timelineGroup}</section>
        )}
        {content.meGroup === null ? null : (
          <SettingsDisclosureGroup title={content.meGroupTitle} {...group(content.meGroupTitle)}>
            {content.meGroup}
          </SettingsDisclosureGroup>
        )}

        <SettingsGroup>
          {devices.data === undefined || devices.data.length === 0 ? null : (
            <SettingsRow
              kind="link"
              to={devicesTo}
              label="Your devices"
              value={format.count(devices.data.length)}
              keepScroll
              dataRow="devices"
            />
          )}
          <SettingsRow kind="link" to="/settings/sharing" label="Sharing" detail={sharingDetail} />
        </SettingsGroup>
      </SectionLevel>
    </section>
  );
}
