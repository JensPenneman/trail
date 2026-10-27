import { AuthProblemNotice } from "../../auth/AuthProblemNotice";
import { classifyAuthError } from "../../auth/classifyAuthError";
import { useAddPasskey } from "../../queries/useAddPasskey";
import { usePasskeys } from "../../queries/usePasskeys";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { PasskeyLinkForm } from "./PasskeyLinkForm";
import { passkeySummary } from "./passkeySummary";

/**
 * Settings › Passkeys: the account's passkeys (a page each, to rename or
 * delete one), adding one here, and a one-time link to add one elsewhere.
 */
export function PasskeysPage() {
  const passkeys = usePasskeys();
  const add = useAddPasskey();
  const announce = useAnnounce();
  return (
    <SettingsPage
      page="passkeys"
      description={
        <>
          A passkey works on the address it was made for. This page is{" "}
          <strong>{window.location.host}</strong>.
        </>
      }
    >
      {add.isError ? <AuthProblemNotice problem={classifyAuthError(add.error)} /> : null}
      {passkeys.isPending ? (
        <LoadingBlock label="Loading passkeys">
          <Skeleton height="6rem" />
        </LoadingBlock>
      ) : passkeys.isError ? (
        <ErrorState
          title="Passkeys could not be loaded"
          error={passkeys.error}
          onRetry={() => void passkeys.refetch()}
        />
      ) : (
        <SettingsGroup title="Your passkeys">
          {passkeys.data.map((passkey) => (
            <SettingsRow
              key={passkey.id}
              kind="link"
              to={`/settings/passkeys/${encodeURIComponent(passkey.id)}`}
              icon="key"
              tone="green"
              label={passkey.name}
              detail={passkeySummary(passkey)}
            />
          ))}
          <SettingsRow
            kind="action"
            label="Add a passkey here"
            busy={add.isPending}
            onClick={() => add.mutate(undefined, { onSuccess: () => announce("Passkey added.") })}
          />
        </SettingsGroup>
      )}
      <SettingsGroup
        title="Add a passkey on another device or address"
        id="passkey-link"
        variant="card"
      >
        <PasskeyLinkForm />
      </SettingsGroup>
    </SettingsPage>
  );
}
