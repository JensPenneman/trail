import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { deviceAppInfo } from "@trail/contracts/deviceApp";
import { useId } from "react";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { describeMe } from "../../people/describeMe";
import { latestOwnDevice } from "../../people/latestOwnDevice";
import { PersonSummary } from "../../people/PersonSummary";
import { useDeviceMode } from "../../queries/useDeviceMode";
import { QuickModeChips, toggleMinutes } from "../../transport/QuickModeChips";
import { Button } from "../../ui/Button";
import { DisclosureButton } from "../../ui/DisclosureButton";
import { DisclosureContent } from "../../ui/DisclosureContent";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { useDisclosure } from "../../ui/useDisclosure";
import { MyDevices } from "./MyDevices";

interface MeCardProps {
  /** The signed-in person's name, for their initials. */
  name: string;
  devices: UseQueryResult<DeviceSummary[]>;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  /** Whether the map shows the signed-in person now. */
  shown: boolean;
  onShowOnMap: () => void;
}

/**
 * The signed-in person, first in the People page's list, as a person and not
 * as their devices: what they are doing now and how fresh that is, from the
 * device that reported last; the quick toggle of the transport mode, which
 * applies to that device; Show on map; and Details, closed at first, with
 * each device's facts and the way to the Devices page.
 */
export function MeCard({ name, devices, now, thresholds, shown, onShowOnMap }: MeCardProps) {
  const format = useFormatter();
  const titleId = useId();
  const details = useDisclosure();
  const list = devices.data ?? [];
  const latest = latestOwnDevice(list);
  // Devices added, nothing uploaded yet: the way to their setup rather than "no location".
  const waiting = list.length > 0 && list.every((device) => device.lastSeenAt === null);
  const mode = useDeviceMode(latest?.lastSeenAt == null ? null : latest.id);
  const location = latest?.lastLocation ?? null;
  const live =
    location !== null && now - Date.parse(location.recordedAt) <= thresholds.liveMinutes * 60_000;
  const doing =
    devices.data === undefined
      ? null
      : list.length === 0
        ? "No devices yet"
        : waiting
          ? "Waiting for the first upload"
          : describeMe(
              {
                location,
                current: mode.data === undefined ? undefined : mode.data.current,
                tripMode: latest?.liveTrip?.mode ?? null,
              },
              now,
              thresholds,
              format,
            );

  return (
    <section className={shown ? "me-card me-card--shown" : "me-card"} aria-labelledby={titleId}>
      <PersonSummary
        title="Me"
        titleId={titleId}
        level={2}
        avatar={{ name, slot: "me" }}
        freshness={location === null ? null : { recordedAt: location.recordedAt, live }}
        doing={doing}
        onMap={shown}
      />

      {devices.isError ? (
        <ErrorState
          title="Your devices could not be loaded"
          error={devices.error}
          onRetry={() => void devices.refetch()}
          retrying={devices.isFetching}
        />
      ) : devices.data !== undefined && list.length === 0 ? (
        <EmptyState
          icon="devices"
          title="Connect your first phone"
          level={3}
          action={
            <LinkButton to="/devices?add=1" variant="primary" icon="plus">
              Add a device
            </LinkButton>
          }
        >
          <p>
            Trail shows where you are as soon as the tracking app on your phone sends its first
            points. Adding one takes a minute: give it a name, choose the app, scan the code, done.
          </p>
        </EmptyState>
      ) : null}

      {waiting && latest !== null ? (
        <p className="me-card__setup">
          Open {deviceAppInfo[latest.source].name} on the phone and check that tracking is on.{" "}
          <Link to={`/devices/${latest.id}`}>Setup details</Link>
        </p>
      ) : null}

      {latest === null || latest.lastSeenAt === null ? null : (
        <QuickModeChips
          key={latest.id}
          deviceId={latest.id}
          deviceName={latest.name}
          description={
            list.length > 1
              ? `Until you stop for ${toggleMinutes} minutes or more or travel another way, for ${latest.name}: the device that reported last. Your other devices are not changed.`
              : `Until you stop for ${toggleMinutes} minutes or more or travel another way, for ${latest.name}.`
          }
          dialogTitle="How are you travelling?"
        />
      )}

      <div className="me-card__actions">
        <Button icon="pin" aria-describedby={titleId} onClick={onShowOnMap}>
          Show on map
        </Button>
        {list.length === 0 ? null : (
          <DisclosureButton disclosure={details} describedBy={titleId}>
            Details
          </DisclosureButton>
        )}
      </div>
      {list.length === 0 ? null : (
        <DisclosureContent disclosure={details} className="me-card__details">
          <MyDevices devices={list} now={now} thresholds={thresholds} />
        </DisclosureContent>
      )}
    </section>
  );
}
