import type { Person, SharedDevice } from "@trail/contracts/person";
import type { OutgoingShare } from "@trail/contracts/share";
import { useContext, useId, useMemo, useRef, useState } from "react";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useSessionUser } from "../../app/useSessionUser";
import { useFormatter } from "../../format/useFormatter";
import { LiveStoreContext } from "../../live/LiveStoreContext";
import { useLiveState } from "../../live/useLiveState";
import { boundsOf } from "../../map/boundsOf";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import type { MapPosition } from "../../map/mapTypes";
import { useMapStyle } from "../../map/useMapStyle";
import { PersonCard } from "../../people/PersonCard";
import { personInitials } from "../../people/personInitials";
import { usePersonColors } from "../../people/usePersonColors";
import { useConfig } from "../../queries/useConfig";
import { useDevices } from "../../queries/useDevices";
import { useHidePerson } from "../../queries/useHidePerson";
import { useIncomingShares } from "../../queries/useIncomingShares";
import { usePeople } from "../../queries/usePeople";
import { useShares } from "../../queries/useShares";
import { OutgoingShareList } from "../../sharing/OutgoingShareList";
import { ShareDialog, type ShareDialogMode } from "../../sharing/ShareDialog";
import { StopShareDialog } from "../../sharing/StopShareDialog";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { PageHeader } from "../../ui/PageHeader";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import "./PeoplePage.css";

const defaultLiveMinutes = 15;
/** How close "Show on map" goes, by what the share reveals. */
const focusZoom = { precise: 16, approximate: 14, area: 11 } as const;

const sharesBackWith = (person: Person, shares: readonly OutgoingShare[]): boolean =>
  shares.some(
    (share) => share.recipient.userId === person.userId || share.recipient.email === person.email,
  );

/**
 * People, after Find My: a calm map of everyone who shares their location with
 * you, a card per person with everything the map shows in text, and the
 * people you share with — each a tap away from changing or stopping it.
 */
export function PeoplePage() {
  const user = useSessionUser();
  const format = useFormatter();
  const peopleHeadingId = useId();
  const youHeadingId = useId();
  const hiddenId = useId();
  const scrollable = useScrollableFocus();
  const config = useConfig();
  const people = usePeople();
  const shares = useShares();
  const incoming = useIncomingShares();
  const devices = useDevices();
  const colors = usePersonColors();
  const { styleUrl, dark } = useMapStyle();
  const now = useNow(15_000);
  const hide = useHidePerson();
  const announce = useAnnounce();
  const live = useLiveState();
  const store = useContext(LiveStoreContext);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const mapRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<ShareDialogMode | null>(null);
  const [stopping, setStopping] = useState<OutgoingShare | null>(null);
  const [focus, setFocus] = useState<{
    key: string;
    lon: number;
    lat: number;
    zoom: number;
  } | null>(null);
  const liveMinutes = config.data?.thresholds.liveMinutes ?? defaultLiveMinutes;

  const list = people.data ?? [];
  const outgoing = shares.data ?? [];
  const hidden = (incoming.data ?? []).filter((share) => share.hiddenAt !== null);
  const suggestions = list
    .filter((person) => !sharesBackWith(person, outgoing))
    .map((person) => ({ name: person.displayName, email: person.email }));

  const positions = useMemo<MapPosition[]>(
    () =>
      (people.data ?? []).flatMap((person) =>
        person.devices.flatMap((device) =>
          device.location === null
            ? []
            : [
                {
                  id: `${person.userId}:${device.id}`,
                  color: colors.hex(person.userId),
                  slot: colors.slot(person.userId),
                  lon: device.location.lon,
                  lat: device.location.lat,
                  accuracy: device.location.accuracy,
                  live: now - Date.parse(device.location.recordedAt) <= liveMinutes * 60_000,
                  initials: personInitials(person.displayName),
                },
              ],
        ),
      ),
    [people.data, colors, now, liveMinutes],
  );
  const bounds = useMemo(
    () => boundsOf(positions.map((position) => [position.lon, position.lat] as const)),
    [positions],
  );
  const fitKey = list
    .map((person) => person.userId)
    .sort()
    .join(",");
  const located = list.filter((person) =>
    person.devices.some((device) => device.location !== null),
  );
  const mapLabel =
    located.length === 0
      ? "Map. Nobody who shares with you has a recent location."
      : `Map of where ${format.list(located.map((person) => person.displayName))} ${located.length === 1 ? "is" : "are"}. The same details are in the cards on this page.`;

  const showOnMap = (person: Person, device: SharedDevice) => {
    if (device.location === null) return;
    setFocus({
      key: `${device.id}:${Date.now()}`,
      lon: device.location.lon,
      lat: device.location.lat,
      zoom: focusZoom[person.share.precision],
    });
    mapRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reducedMotion ? "auto" : "smooth",
    });
    announce(`The map shows ${person.displayName}.`);
  };

  const notices = live.shareNotices.flatMap((notice) => {
    const person = list.find((candidate) => candidate.share.id === notice.shareId);
    return person === undefined ? [] : [{ notice, person }];
  });

  const description =
    people.isPending || shares.isPending
      ? undefined
      : list.length === 0 && outgoing.length === 0
        ? "Share your location with family and friends, one way and for as long as you choose."
        : `${list.length === 0 ? "Nobody shares" : `${format.count(list.length)} ${list.length === 1 ? "person shares" : "people share"}`} with you · you share with ${format.count(outgoing.length)}`;

  return (
    <div className="map-layout people-page">
      <DocumentTitle title="People" />
      <div className="map-layout__head">
        <PageHeader
          title="People"
          description={description}
          actions={
            <Button variant="primary" icon="users" onClick={() => setDialog({ kind: "create" })}>
              Share my location
            </Button>
          }
        />
      </div>

      <div className="map-layout__map" ref={mapRef}>
        {styleUrl === null ? null : (
          <LazyTrailMap
            label={mapLabel}
            styleUrl={styleUrl}
            dark={dark}
            positions={positions}
            fit={{ key: fitKey, bounds: people.isPending ? null : bounds, maxZoom: 14 }}
            focus={focus}
            cooperativeGestures
          />
        )}
      </div>

      <section className="map-layout__body" aria-label="People and sharing" ref={scrollable}>
        {notices.map(({ notice, person }) => (
          <Notice
            key={notice.shareId}
            tone="success"
            role="status"
            title={`${person.displayName} shares their location with you`}
            action={
              <Button variant="ghost" onClick={() => store?.dismissShareNotice(notice.shareId)}>
                OK
              </Button>
            }
          />
        ))}

        <section className="section" aria-labelledby={peopleHeadingId}>
          <h2 className="section__title" id={peopleHeadingId}>
            Sharing with you
          </h2>
          {people.isPending ? (
            <LoadingBlock label="Loading people">
              <Skeleton height="12rem" />
            </LoadingBlock>
          ) : people.isError ? (
            <ErrorState
              title="People could not be loaded"
              error={people.error}
              onRetry={() => void people.refetch()}
              retrying={people.isFetching}
            />
          ) : list.length === 0 ? (
            <div className="card">
              <EmptyState icon="users" title="Nobody shares with you yet" level={3}>
                <p>
                  When someone shares their location with {user.email}, they appear here and on the
                  map. Sharing works one way: share yours and they can share back.
                </p>
              </EmptyState>
            </div>
          ) : (
            <PlainList className="people-page__cards">
              {list.map((person) => (
                <li key={person.userId}>
                  <PersonCard
                    person={person}
                    colorSlot={colors.slot(person.userId)}
                    now={now}
                    liveMinutes={liveMinutes}
                    sharesBack={sharesBackWith(person, outgoing)}
                    onShowOnMap={(device) => showOnMap(person, device)}
                    onShareBack={() => setDialog({ kind: "create", email: person.email })}
                    hiding={hide.isPending && hide.variables.shareId === person.share.id}
                    onHide={() =>
                      hide.mutate(
                        { shareId: person.share.id, hidden: true },
                        {
                          onSuccess: () =>
                            announce(
                              `${person.displayName} is hidden. Show them again under Hidden.`,
                            ),
                        },
                      )
                    }
                  />
                </li>
              ))}
            </PlainList>
          )}
          {hide.isError ? <ErrorState title="Nobody was hidden" error={hide.error} /> : null}

          {hidden.length === 0 ? null : (
            <details className="disclosure people-page__hidden">
              <summary>
                <Icon name="chevronDown" className="disclosure__chevron" />
                <span id={hiddenId}>Hidden ({format.count(hidden.length)})</span>
              </summary>
              <PlainList className="card card--flush row-list">
                {hidden.map((share) => (
                  <li key={share.id} className="row-list__item">
                    <div className="row-list__main">
                      <p className="row-list__title">{share.owner.displayName}</p>
                      <p className="row-list__meta">
                        Still shares with you; you see nothing of them while they are hidden.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      busy={hide.isPending && hide.variables.shareId === share.id}
                      aria-label={`Show ${share.owner.displayName} again`}
                      onClick={() =>
                        hide.mutate(
                          { shareId: share.id, hidden: false },
                          {
                            onSuccess: () => announce(`${share.owner.displayName} is shown again.`),
                          },
                        )
                      }
                    >
                      Show
                    </Button>
                  </li>
                ))}
              </PlainList>
            </details>
          )}
        </section>

        <section className="section" aria-labelledby={youHeadingId}>
          <div className="section__header">
            <h2 className="section__title" id={youHeadingId}>
              You share with
            </h2>
          </div>
          {shares.isPending ? (
            <LoadingBlock label="Loading your shares">
              <Skeleton height="4rem" />
            </LoadingBlock>
          ) : shares.isError ? (
            <ErrorState
              title="Your shares could not be loaded"
              error={shares.error}
              onRetry={() => void shares.refetch()}
              retrying={shares.isFetching}
            />
          ) : outgoing.length === 0 ? (
            <div className="card">
              <p>
                Nobody sees your location. Share it with someone, for an hour, until the end of the
                day or for as long as you like.
              </p>
              <div className="cluster">
                <Button icon="users" onClick={() => setDialog({ kind: "create" })}>
                  Share my location
                </Button>
              </div>
            </div>
          ) : (
            <div className="card card--flush">
              <OutgoingShareList
                shares={outgoing}
                devices={devices.data ?? []}
                now={now}
                onChange={(share) => setDialog({ kind: "edit", share })}
                onStop={setStopping}
              />
            </div>
          )}
          <p className="muted people-page__links">
            <Icon name="globe" /> For someone without an account, make a public link in{" "}
            <LinkButton to="/settings" variant="ghost">
              Settings
            </LinkButton>
          </p>
        </section>
      </section>

      <ShareDialog mode={dialog} onClose={() => setDialog(null)} suggestions={suggestions} />
      <StopShareDialog share={stopping} onClose={() => setStopping(null)} />
    </div>
  );
}
