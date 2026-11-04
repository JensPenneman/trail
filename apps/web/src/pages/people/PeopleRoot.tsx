import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import { useEffect, useId, useMemo, useState } from "react";
import { useSessionUser } from "../../app/useSessionUser";
import { fold } from "../../format/fold";
import { useFormatter } from "../../format/useFormatter";
import type { PersonColors } from "../../people/usePersonColors";
import { useIncomingShares } from "../../queries/useIncomingShares";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { filterPeople, searchFrom } from "./filterPeople";
import { ConnectFirstPhone } from "./MeDetails";
import { orderPeople } from "./orderPeople";
import { MeRow, PersonRow } from "./PersonRow";
import { ShareConfirmations } from "./ShareConfirmations";
import "../../ui/Field.css";
import "./PeopleRoot.css";

interface PeopleRootProps {
  people: UseQueryResult<Person[]>;
  devices: UseQueryResult<DeviceSummary[]>;
  personColors: PersonColors;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  /** The page of someone (`me` or a user id). */
  linkTo: (person: string) => string;
  /** The Hidden level. */
  hiddenTo: string;
}

/**
 * The root of the sidebar (docs/architecture.md §14): Me first, then those who
 * share with you — live now by name, then by when they were last seen, then
 * those with no location — a search once there are many, and a row for the
 * people one hid. What the view shows of the map is the map's; nothing of it
 * is summarised here.
 */
export function PeopleRoot({
  people,
  devices,
  personColors,
  now,
  thresholds,
  linkTo,
  hiddenTo,
}: PeopleRootProps) {
  const user = useSessionUser();
  const format = useFormatter();
  const incoming = useIncomingShares();
  const everyone = people.data ?? [];
  const ordered = useMemo(
    () => orderPeople(everyone, now, thresholds.liveMinutes),
    [everyone, now, thresholds.liveMinutes],
  );
  const hiddenCount = (incoming.data ?? []).filter((share) => share.hiddenAt !== null).length;
  const titleId = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const searching = ordered.length >= searchFrom && fold(query) !== "";
  const shown = searching ? filterPeople(ordered, query) : ordered;
  const announce = useAnnounce();
  // What a search found is said after a short pause, not at every key.
  useEffect(() => {
    if (!searching) return undefined;
    const timer = window.setTimeout(
      () =>
        announce(
          shown.length === 0
            ? `No one called “${query.trim()}”`
            : `${format.count(shown.length)} ${shown.length === 1 ? "person" : "people"}`,
        ),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [searching, shown.length, query, announce, format]);

  return (
    <div className="people-root">
      <ShareConfirmations people={everyone} />

      <PlainList className="people-root__rows" label="Me">
        <li data-peek-end>
          <MeRow
            name={user.displayName}
            devices={devices}
            now={now}
            thresholds={thresholds}
            to={linkTo("me")}
          />
          {devices.isError ? (
            <ErrorState
              title="Your devices could not be loaded"
              error={devices.error}
              onRetry={() => void devices.refetch()}
              retrying={devices.isFetching}
            />
          ) : devices.data !== undefined && devices.data.length === 0 ? (
            <ConnectFirstPhone level={2} />
          ) : null}
        </li>
      </PlainList>

      {people.isPending ? (
        <LoadingBlock label="Loading people">
          <Skeleton height="4rem" />
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : people.isError ? (
        <ErrorState
          title="People could not be loaded"
          error={people.error}
          onRetry={() => void people.refetch()}
          retrying={people.isFetching}
        />
      ) : ordered.length === 0 ? null : (
        <section className="people-root__group" aria-labelledby={titleId}>
          <h2 className="people-root__title" id={titleId}>
            Sharing with you
          </h2>
          {ordered.length < searchFrom ? null : (
            <search className="people-root__search">
              <label className="visually-hidden" htmlFor={searchId}>
                Search people
              </label>
              <Icon name="search" className="people-root__search-icon" />
              <input
                id={searchId}
                type="search"
                className="input people-root__search-input"
                placeholder="Search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </search>
          )}
          {searching && shown.length === 0 ? (
            <p className="people-root__none">No one called “{query.trim()}”</p>
          ) : (
            <PlainList className="people-root__rows" labelledBy={titleId}>
              {shown.map((person) => (
                <li key={person.userId} className="people-root__person">
                  <PersonRow
                    person={person}
                    colorSlot={personColors.slot(person.userId)}
                    now={now}
                    liveMinutes={thresholds.liveMinutes}
                    to={linkTo(person.userId)}
                  />
                </li>
              ))}
            </PlainList>
          )}
        </section>
      )}

      {hiddenCount === 0 ? null : (
        <SettingsGroup>
          <SettingsRow
            kind="link"
            to={hiddenTo}
            label={`Hidden (${format.count(hiddenCount)})`}
            keepScroll
            dataRow="hidden"
          />
        </SettingsGroup>
      )}
    </div>
  );
}
