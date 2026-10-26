import type { ApiToken, ApiTokenWithSecretResponse } from "@trail/contracts/apiToken";
import { useState } from "react";
import { useRollApiToken } from "../../queries/useRollApiToken";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { Notice } from "../../ui/Notice";
import { useAnnounce } from "../../ui/useAnnounce";
import { ApiTokenSecret } from "./ApiTokenSecret";

interface RollApiTokenDialogProps {
  token: ApiToken | null;
  onClose: () => void;
}

/** A new secret for a token, after a confirmation: the current one stops working at once. */
export function RollApiTokenDialog({ token, onClose }: RollApiTokenDialogProps) {
  const roll = useRollApiToken();
  const announce = useAnnounce();
  const [rolled, setRolled] = useState<ApiTokenWithSecretResponse | null>(null);
  const close = () => {
    setRolled(null);
    roll.reset();
    onClose();
  };
  const name = rolled?.token.name ?? token?.name ?? "token";
  return (
    <Dialog
      open={token !== null}
      onClose={close}
      title={rolled === null ? `Roll “${name}”?` : `Copy the new secret of “${name}”`}
      size={rolled === null ? "s" : "m"}
      dismissible={rolled === null && !roll.isPending}
    >
      {rolled === null ? (
        <>
          <Notice tone="warning" title="The current secret stops working immediately">
            <p>
              Whatever uses it is refused until it has the new one. Name, permissions, devices and
              expiry stay as they are.
            </p>
          </Notice>
          {roll.isError ? <ErrorState title="The token was not rolled" error={roll.error} /> : null}
          <div className="dialog__actions">
            <Button onClick={close} disabled={roll.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="refresh"
              busy={roll.isPending}
              onClick={() => {
                if (token === null) return;
                roll.mutate(token.id, {
                  onSuccess: (response) => {
                    setRolled(response);
                    announce(`Token ${response.token.name} rolled. Copy the new secret now.`);
                  },
                });
              }}
            >
              Roll token
            </Button>
          </div>
        </>
      ) : (
        <ApiTokenSecret secret={rolled.secret} onDone={close} />
      )}
    </Dialog>
  );
}
