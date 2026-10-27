import { useIsMutating } from "@tanstack/react-query";
import type { ApiTokenTemplate, ApiTokenWithSecretResponse } from "@trail/contracts/apiToken";
import { useState } from "react";
import { queryKeys } from "../../api/queryKeys";
import { Dialog } from "../../ui/Dialog";
import { useAnnounce } from "../../ui/useAnnounce";
import { ApiTokenForm } from "./ApiTokenForm";
import { ApiTokenSecret } from "./ApiTokenSecret";

interface CreateApiTokenDialogProps {
  open: boolean;
  onClose: () => void;
  /** The template the form starts with (Read-only unless said otherwise). */
  template?: ApiTokenTemplate;
}

/** Creating a token: its settings, then its secret, once. */
export function CreateApiTokenDialog({ open, onClose, template }: CreateApiTokenDialogProps) {
  const announce = useAnnounce();
  // Closing while the token is being created would lose its secret, which is only in the answer.
  const creating = useIsMutating({ mutationKey: queryKeys.createApiToken }) > 0;
  const [created, setCreated] = useState<ApiTokenWithSecretResponse | null>(null);
  const close = () => {
    setCreated(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={created === null ? "Create an API token" : `Copy the token “${created.token.name}”`}
      description={
        created === null
          ? "For a script, an app or an agent that uses the Trail API on your behalf."
          : undefined
      }
      size={created === null ? "l" : "m"}
      dismissible={created === null && !creating}
    >
      {created === null ? (
        <ApiTokenForm
          {...(template === undefined ? {} : { template })}
          onCreated={(response) => {
            setCreated(response);
            announce(`Token ${response.token.name} created. Copy it now.`);
          }}
          onCancel={close}
        />
      ) : (
        <ApiTokenSecret secret={created.secret} onDone={close} />
      )}
    </Dialog>
  );
}
