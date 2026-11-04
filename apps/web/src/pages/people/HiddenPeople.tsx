import { offlineReasonId, useReadOnly } from "../../app/useReadOnly";
import { useFormatter } from "../../format/useFormatter";
import { useHidePerson } from "../../queries/useHidePerson";
import { useIncomingShares } from "../../queries/useIncomingShares";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { PanelLevel } from "./PanelLevel";

/**
 * The people one hid, a level below the root (`?list=hidden`): each shows what
 * hiding means and can be shown again, which takes them back to the root list.
 */
export function HiddenPeople({ backTo }: { backTo: string }) {
  const format = useFormatter();
  const incoming = useIncomingShares();
  const hide = useHidePerson();
  const announce = useAnnounce();
  const readOnly = useReadOnly();
  const hidden = (incoming.data ?? []).filter((share) => share.hiddenAt !== null);
  return (
    <PanelLevel title="Hidden" backTo={backTo} backLabel="People">
      {incoming.isPending ? (
        <LoadingBlock label="Loading">
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : incoming.isError ? (
        <ErrorState
          title="The hidden people could not be loaded"
          error={incoming.error}
          onRetry={() => void incoming.refetch()}
          retrying={incoming.isFetching}
        />
      ) : hidden.length === 0 ? (
        <p className="panel-level__empty">Nobody is hidden.</p>
      ) : (
        <PlainList className="card card--flush row-list" label="Hidden people">
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
                disabled={readOnly}
                aria-describedby={readOnly ? offlineReasonId : undefined}
                aria-label={`Show ${share.owner.displayName} again`}
                onClick={() =>
                  hide.mutate(
                    { shareId: share.id, hidden: false },
                    {
                      onSuccess: () =>
                        announce(
                          `${share.owner.displayName} is shown again.${
                            hidden.length === 1
                              ? " Nobody is hidden."
                              : ` ${format.count(hidden.length - 1)} still hidden.`
                          }`,
                        ),
                    },
                  )
                }
              >
                Show
              </Button>
            </li>
          ))}
        </PlainList>
      )}
      {hide.isError ? <ErrorState title="Nobody was shown again" error={hide.error} /> : null}
    </PanelLevel>
  );
}
