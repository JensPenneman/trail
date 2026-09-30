import type { Passkey } from "@trail/contracts/passkey";
import { useState } from "react";
import { AuthProblemNotice } from "../../auth/AuthProblemNotice";
import { classifyAuthError } from "../../auth/classifyAuthError";
import { useFormatter } from "../../format/useFormatter";
import { useAddPasskey } from "../../queries/useAddPasskey";
import { usePasskeys } from "../../queries/usePasskeys";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { DeletePasskeyDialog } from "./DeletePasskeyDialog";
import { RenamePasskeyDialog } from "./RenamePasskeyDialog";

/** The passkeys of this account, on this address and others. */
export function PasskeysSection({ headingId }: { headingId: string }) {
  const format = useFormatter();
  const passkeys = usePasskeys();
  const add = useAddPasskey();
  const announce = useAnnounce();
  const now = useNow(60_000);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [deleting, setDeleting] = useState<Passkey | null>(null);

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Passkeys
        </h2>
        <Button
          icon="plus"
          busy={add.isPending}
          onClick={() => add.mutate(undefined, { onSuccess: () => announce("Passkey added.") })}
        >
          Add a passkey here
        </Button>
      </div>
      <p className="section__description">
        A passkey works on the address it was created for. This page is {window.location.host}.
      </p>
      {add.isError ? <AuthProblemNotice problem={classifyAuthError(add.error)} /> : null}
      {passkeys.isPending ? (
        <LoadingBlock label="Loading passkeys">
          <Skeleton height="4.5rem" />
        </LoadingBlock>
      ) : passkeys.isError ? (
        <ErrorState
          title="Passkeys could not be loaded"
          error={passkeys.error}
          onRetry={() => void passkeys.refetch()}
        />
      ) : (
        <PlainList className="row-list card card--flush">
          {passkeys.data.map((passkey) => (
            <li key={passkey.id} className="row-list__item">
              <span className="settings__row-icon">
                <Icon name="key" />
              </span>
              <div className="row-list__main">
                <p className="row-list__title">{passkey.name}</p>
                <p className="row-list__meta">
                  {passkey.provider ?? "Unknown provider"} ·{" "}
                  {passkey.backedUp ? "synced" : "on one device"} ·{" "}
                  {passkey.usableHere ? "works on this address" : `for ${passkey.rpId}`}
                </p>
                <p className="row-list__meta">
                  Added {format.dateTime(passkey.createdAt)}
                  {passkey.lastUsedAt === null
                    ? " · never used"
                    : ` · last used ${format.relative(passkey.lastUsedAt, now)}`}
                </p>
              </div>
              <div className="settings__row-actions">
                <Button variant="ghost" icon="pencil" iconOnly onClick={() => setRenaming(passkey)}>
                  Rename {passkey.name}
                </Button>
                <Button variant="ghost" icon="trash" iconOnly onClick={() => setDeleting(passkey)}>
                  Delete {passkey.name}
                </Button>
              </div>
            </li>
          ))}
        </PlainList>
      )}
      <RenamePasskeyDialog passkey={renaming} onClose={() => setRenaming(null)} />
      <DeletePasskeyDialog passkey={deleting} onClose={() => setDeleting(null)} />
    </section>
  );
}
