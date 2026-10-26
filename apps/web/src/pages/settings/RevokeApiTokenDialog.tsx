import { type ApiToken, apiTokenRetentionDays } from "@trail/contracts/apiToken";
import { useRevokeApiToken } from "../../queries/useRevokeApiToken";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { useAnnounce } from "../../ui/useAnnounce";

interface RevokeApiTokenDialogProps {
  token: ApiToken | null;
  onClose: () => void;
}

export function RevokeApiTokenDialog({ token, onClose }: RevokeApiTokenDialogProps) {
  const revoke = useRevokeApiToken();
  const announce = useAnnounce();
  const close = () => {
    revoke.reset();
    onClose();
  };
  return (
    <Dialog
      open={token !== null}
      onClose={close}
      title={`Revoke “${token?.name ?? "token"}”?`}
      size="s"
      dismissible={!revoke.isPending}
    >
      <p>
        Whatever uses it loses access at once, and that cannot be undone. The token stays in the
        list as revoked for {apiTokenRetentionDays} days.
      </p>
      {revoke.isError ? (
        <ErrorState title="The token was not revoked" error={revoke.error} />
      ) : null}
      <div className="dialog__actions">
        <Button onClick={close} disabled={revoke.isPending}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon="trash"
          busy={revoke.isPending}
          onClick={() => {
            if (token === null) return;
            revoke.mutate(token.id, {
              onSuccess: () => {
                announce(`Token ${token.name} revoked.`);
                close();
              },
            });
          }}
        >
          Revoke token
        </Button>
      </div>
    </Dialog>
  );
}
