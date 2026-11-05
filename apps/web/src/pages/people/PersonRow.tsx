import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { PersonSummary } from "../../people/PersonSummary";
import { personSummaryProps } from "../../people/personSummaryProps";
import { Icon } from "../../ui/Icon";
import { useMeSummary } from "./useMeSummary";
import "./PersonRow.css";

interface PersonRowProps {
  person: Person;
  colorSlot: number;
  now: number;
  /** Positions younger than this count as live (the server's live window). */
  liveMinutes: number;
  /** The person's detail: the page with `?person=` set. */
  to: string;
}

/**
 * Someone who shares their location, as a row of the People list, Find My
 * style: who and how far, what they are doing and how fresh that is, and a
 * battery glyph when the share includes it. The whole row is one link to
 * their detail, and its name is what the row says, in order.
 */
export function PersonRow({ person, colorSlot, now, liveMinutes, to }: PersonRowProps) {
  const format = useFormatter();
  return (
    <Link to={to} className="person-row" data-person={person.userId} preventScrollReset>
      <PersonSummary
        title={person.displayName}
        level="row"
        {...personSummaryProps(person, colorSlot, now, liveMinutes, format)}
      />
      <Icon name="chevronRight" className="person-row__chevron" />
    </Link>
  );
}

interface MeRowProps {
  /** The signed-in person's name, for their initials. */
  name: string;
  devices: UseQueryResult<DeviceSummary[]>;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  to: string;
}

/** The signed-in person, first in the list: a row like the others, from their latest device. */
export function MeRow({ name, devices, now, thresholds, to }: MeRowProps) {
  const { freshness, doing } = useMeSummary(devices, now, thresholds);
  return (
    <Link to={to} className="person-row" data-person="me" preventScrollReset>
      <PersonSummary
        title="Me"
        level="row"
        avatar={{ name, slot: "me" }}
        freshness={freshness}
        doing={doing}
      />
      <Icon name="chevronRight" className="person-row__chevron" />
    </Link>
  );
}
