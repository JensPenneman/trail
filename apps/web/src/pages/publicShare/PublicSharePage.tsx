import { type PublicShareResponse, shareLinkSecretPattern } from "@trail/contracts/shareLink";
import { trackSegments } from "@trail/contracts/trackSegments";
import { useMemo } from "react";
import { useLocation } from "react-router";
import { ApiError } from "../../api/ApiError";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useRouteFocus } from "../../app/useRouteFocus";
import { devicePalette, devicePaletteSize } from "../../devices/devicePalette";
import { useFormatter } from "../../format/useFormatter";
import { boundsOf } from "../../map/boundsOf";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import type { MapPosition, MapTrack } from "../../map/mapTypes";
import { useMapStyle } from "../../map/useMapStyle";
import { describeActivity } from "../../people/describeActivity";
import { useConfig } from "../../queries/useConfig";
import { publicShareRefreshMs, usePublicShare } from "../../queries/usePublicShare";
import { precisionInfo } from "../../sharing/shareText";
import { localDateOf } from "../../time/localDateOf";
import { useNow } from "../../time/useNow";
import { BatteryIndicator } from "../../ui/BatteryIndicator";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PageHeader } from "../../ui/PageHeader";
import { PlainList } from "../../ui/PlainList";
import { RelativeTime } from "../../ui/RelativeTime";
import { Skeleton } from "../../ui/Skeleton";
import { Wordmark } from "../../ui/Wordmark";
import "./PublicSharePage.css";

const defaultLiveMinutes = 15;

/** The secret in the address's fragment (`#trls_…`), or null when there is none of its shape. */
function secretOf(hash: string): string | null {
  let value = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  return shareLinkSecretPattern.test(value) ? value : null;
}

/** The owner's devices in the palette's order, as on their own pages. */
const slotOf = (index: number): number => index % devicePaletteSize;

/**
 * The page of a public link (`/s#<secret>`), for people without an account:
 * the label, a map of the shared devices, how fresh each position is, battery
 * and activity when the link includes them, and when the link expires. It
 * refreshes every 15 seconds and never asks for a session; an ended or
 * unknown link gets a friendly page of its own. The secret stays in the
 * fragment (so a reload works) and is sent in a header, never in a URL.
 */
export function PublicSharePage() {
  useRouteFocus();
  const { hash } = useLocation();
  const secret = secretOf(hash);
  const share = usePublicShare(secret ?? "", secret !== null);
  const now = useNow(15_000);
  const expired =
    share.data !== undefined && Date.parse(share.data.expiresAt) <= now ? "share_expired" : null;
  const notFound =
    share.error instanceof ApiError && share.error.status === 404 ? share.error.code : null;
  const ended = secret === null ? "not_found" : (expired ?? notFound);

  if (ended !== null) return <LinkEnded expired={ended === "share_expired"} />;
  if (share.data === undefined) {
    return (
      <PublicFrame title="Shared location">
        {share.isError ? (
          <ErrorState
            title="This page could not be loaded"
            error={share.error}
            onRetry={() => void share.refetch()}
            retrying={share.isFetching}
          />
        ) : (
          <LoadingBlock label="Loading the shared location">
            <Skeleton height="16rem" />
          </LoadingBlock>
        )}
      </PublicFrame>
    );
  }
  return <SharedLocation share={share.data} now={now} />;
}

function SharedLocation({ share, now }: { share: PublicShareResponse; now: number }) {
  const format = useFormatter();
  const config = useConfig();
  const { style, dark } = useMapStyle();
  const liveMinutes = config.data?.thresholds.liveMinutes ?? defaultLiveMinutes;
  const palette = dark ? devicePalette.dark : devicePalette.light;

  const positions = useMemo<MapPosition[]>(
    () =>
      share.devices.flatMap((device, index) =>
        device.location === null
          ? []
          : [
              {
                id: device.key,
                color: palette[slotOf(index)] ?? palette[0],
                slot: slotOf(index),
                lon: device.location.lon,
                lat: device.location.lat,
                accuracy: device.location.accuracy,
                live: now - Date.parse(device.location.recordedAt) <= liveMinutes * 60_000,
              },
            ],
      ),
    [share.devices, palette, now, liveMinutes],
  );
  const tracks = useMemo<MapTrack[]>(
    () =>
      share.devices.flatMap((device, index) =>
        device.track === null || device.track.length === 0
          ? []
          : [
              {
                id: device.key,
                color: palette[slotOf(index)] ?? palette[0],
                segments: trackSegments(device.track).map((segment) =>
                  segment.map((point) => [point[0], point[1]] as const),
                ),
              },
            ],
      ),
    [share.devices, palette],
  );
  const bounds = useMemo(
    () =>
      boundsOf([
        ...positions.map((position) => [position.lon, position.lat] as const),
        ...tracks.flatMap((track) => track.segments.flat()),
      ]),
    [positions, tracks],
  );
  const located = share.devices.filter((device) => device.location !== null);
  const mapLabel =
    located.length === 0
      ? "Map. No recent position is shared right now."
      : `Map of the shared location of ${format.list(located.map((device) => device.name))}. The same details are listed on this page.`;

  return (
    <PublicFrame title={share.label} wide>
      <div className="map-layout public-share__layout">
        <div className="map-layout__head">
          <PageHeader
            title={share.label}
            description={`Shared location · ${precisionInfo[share.precision].short.toLowerCase()} · updated every ${publicShareRefreshMs / 1000} seconds`}
          />
        </div>
        <div className="map-layout__map">
          {style === null ? null : (
            <LazyTrailMap
              label={mapLabel}
              mapStyle={style}
              dark={dark}
              positions={positions}
              tracks={tracks}
              fit={{
                key: String(positions.length),
                bounds,
                maxZoom:
                  share.precision === "precise" ? 15 : share.precision === "approximate" ? 13 : 10,
              }}
              cooperativeGestures
            />
          )}
        </div>
        <section className="map-layout__body" aria-label="Shared devices">
          <PlainList className="public-share__devices">
            {share.devices.map((device, index) => (
              <li key={device.key} className="public-share__device">
                <p className="public-share__device-name">
                  <DeviceSwatch slot={slotOf(index)} />
                  <span>{device.name}</span>
                </p>
                {device.location === null ? (
                  <p className="muted">No recent position.</p>
                ) : (
                  <dl className="public-share__facts">
                    <div>
                      <dt>Updated</dt>
                      <dd>
                        <RelativeTime value={device.location.recordedAt} tickMs={15_000} />
                      </dd>
                    </div>
                    {device.activity === null ? null : (
                      <div>
                        <dt>Doing</dt>
                        <dd>
                          {describeActivity(device.location, device.activity, format, {
                            live:
                              now - Date.parse(device.location.recordedAt) <= liveMinutes * 60_000,
                          }) ?? "—"}
                        </dd>
                      </div>
                    )}
                    {device.battery === null ? null : (
                      <div>
                        <dt>Battery</dt>
                        <dd>
                          <BatteryIndicator battery={device.battery} />
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </PlainList>
          <p className="public-share__expiry">
            <Icon name="calendar" />
            <span>{expiryNotice(share.expiresAt, format, now)}</span>
          </p>
          <p className="muted public-share__about">
            Shared with Trail, a self-hosted location history. Only people with this link see this
            page{share.historyDays === null ? "" : ", with the route of the last days"}.
          </p>
        </section>
      </div>
    </PublicFrame>
  );
}

/** "This link expires today at 13:41 (in 25 min)." — the countdown only in its last hour. */
function expiryNotice(
  expiresAt: string,
  format: ReturnType<typeof useFormatter>,
  now: number,
): string {
  const end = Date.parse(expiresAt);
  const today = localDateOf(end, format.timeZone) === localDateOf(now, format.timeZone);
  const when = today ? `today at ${format.time(end)}` : `on ${format.dayTime(end)}`;
  const soon = end - now < 3_600_000 ? ` (${format.relative(end, now)})` : "";
  return `This link expires ${when}${soon}.`;
}

/** The page's frame: the brand, no navigation, the content as `main`. */
function PublicFrame({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "public-share public-share--wide" : "public-share"}>
      <DocumentTitle title={title} />
      <header className="public-share__bar">
        <Wordmark />
      </header>
      <main id="main" className="public-share__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function LinkEnded({ expired }: { expired: boolean }) {
  return (
    <PublicFrame title={expired ? "This link has ended" : "This link does not work"}>
      <div className="public-share__ended">
        <h1 className="visually-hidden" data-page-title tabIndex={-1}>
          {expired ? "This link has ended" : "This link does not work"}
        </h1>
        <EmptyState
          icon={expired ? "calendar" : "warning"}
          title={expired ? "This link has ended" : "This link does not work"}
          level={2}
        >
          <p>
            {expired
              ? "The person who shared their location stopped sharing it here, or the time they chose has passed. Ask them for a new link if you still need it."
              : "Check that you opened the whole link, exactly as it was sent to you."}
          </p>
        </EmptyState>
      </div>
    </PublicFrame>
  );
}
