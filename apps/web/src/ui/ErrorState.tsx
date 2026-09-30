import { Button } from "./Button";
import { errorMessage } from "./errorMessage";
import { Notice } from "./Notice";

interface ErrorStateProps {
  title: string;
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}

/** A failed load, with the reason and a way to try again. */
export function ErrorState({ title, error, onRetry, retrying = false }: ErrorStateProps) {
  return (
    <Notice
      tone="danger"
      title={title}
      role="alert"
      action={
        onRetry === undefined ? undefined : (
          <Button icon="refresh" onClick={onRetry} busy={retrying}>
            Try again
          </Button>
        )
      }
    >
      <p>{errorMessage(error)}</p>
    </Notice>
  );
}
