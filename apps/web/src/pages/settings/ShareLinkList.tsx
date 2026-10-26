import type { ShareLink } from "@trail/contracts/shareLink";
import { useFormatter } from "../../format/useFormatter";
import { useDevices } from "../../queries/useDevices";
import { useShareLinks } from "../../queries/useShareLinks";
import { useTurnOffShareLink } from "../../queries/useTurnOffShareLink";
import { devicesText, historyText, precisionInfo } from "../../sharing/shareText";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";

const views = (link: ShareLink, relative: (iso: string) => string): string =>
  link.viewCount === 0 || link.lastViewedAt === null
    ? "Not opened yet"
    : `Opened ${link.viewCount === 1 ? "once" : `${link.viewCount} times`}, last ${relative(link.lastViewedAt)}`;

/** The public links that work or recently expired: what each shows, its views, and turning it off. */
export function ShareLinkList() {
  const format = useFormatter();
  const now = useNow(60_000);
  const links = useShareLinks();
  const devices = useDevices();
  const turnOff = useTurnOffShareLink();
  const announce = useAnnounce();
  if (links.isPending) {
    return (
      <LoadingBlock label="Loading links">
        <Skeleton height="3rem" />
      </LoadingBlock>
    );
  }
  if (links.isError) {
    return (
      <ErrorState
        title="Links could not be loaded"
        error={links.error}
        onRetry={() => void links.refetch()}
      />
    );
  }
  if (links.data.length === 0) return <p className="muted settings__padded">No links yet.</p>;
  return (
    <>
      {turnOff.isError ? (
        <div className="settings__padded">
          <ErrorState title="The link was not turned off" error={turnOff.error} />
        </div>
      ) : null}
      <PlainList className="row-list">
        {links.data.map((link) => {
          const active = link.status === "active";
          return (
            <li key={link.id} className="row-list__item">
              <div className="row-list__main">
                <p className="row-list__title">
                  {link.label}
                  <span
                    className={`settings__tag${active ? " settings__tag--open" : " settings__tag--expired"}`}
                  >
                    {active ? "Works" : "Expired"}
                  </span>
                </p>
                <p className="row-list__meta">
                  {precisionInfo[link.precision].label} · {historyText(link.historyDays)} ·{" "}
                  {devicesText(link.deviceIds, devices.data ?? [], format)}
                  {link.includeDetails ? " · battery and activity" : ""}
                </p>
                <p className="row-list__meta">
                  {active ? "Until" : "Ended"} {format.dateTime(link.expiresAt)} ·{" "}
                  {views(link, (iso) => format.relative(iso, now))}
                </p>
              </div>
              <Button
                variant={active ? "danger-outline" : "ghost"}
                {...(active ? {} : { icon: "trash" as const })}
                busy={turnOff.isPending && turnOff.variables === link.id}
                aria-label={`${active ? "Turn off" : "Remove"} the link “${link.label}”`}
                onClick={() =>
                  turnOff.mutate(link.id, {
                    onSuccess: () => announce(active ? "The link is turned off." : "Link removed."),
                  })
                }
              >
                {active ? "Turn off" : "Remove"}
              </Button>
            </li>
          );
        })}
      </PlainList>
    </>
  );
}
