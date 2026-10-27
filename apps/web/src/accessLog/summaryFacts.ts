import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import type { AccessSeries } from "./AccessSeriesChart";

/** Whether anyone but you looked in the period: a person, a link's visitor or a token. */
export const othersLooked = (summary: DataAccessSummary): boolean => {
  const { person, link, token } = summary.totals.byActorKind;
  return person + link + token > 0;
};

/** How many people, links and tokens looked in the period (each at most 20 the summary lists). */
export const viewerCount = (summary: DataAccessSummary): number =>
  summary.people.length + summary.links.length + summary.tokens.length;

/**
 * The series of accesses by who made them, each always in its own colour:
 * people, link visitors, tokens — and you, muted, while your own activity is shown.
 */
export function actorSeries(showOwn: boolean): AccessSeries[] {
  return [
    {
      key: "person",
      label: "People",
      tone: "category-1",
      value: (day) => day.byActorKind.person,
    },
    {
      key: "link",
      label: "Link visitors",
      tone: "category-2",
      value: (day) => day.byActorKind.link,
    },
    {
      key: "token",
      label: "API tokens",
      tone: "category-3",
      value: (day) => day.byActorKind.token,
    },
    ...(showOwn
      ? [
          {
            key: "owner",
            label: "You",
            tone: "muted" as const,
            value: (day: DataAccessSummary["series"][number]) => day.byActorKind.owner,
          },
        ]
      : []),
  ];
}
