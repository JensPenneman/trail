import { Button } from "../ui/Button";
import { errorMessage } from "../ui/errorMessage";
import { Wordmark } from "../ui/Wordmark";
import "./ServerUnavailable.css";

interface ServerUnavailableProps {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}

/** The session could not even be checked: the server or the network is down. */
export function ServerUnavailable({ error, onRetry, retrying }: ServerUnavailableProps) {
  return (
    <main className="server-unavailable">
      <Wordmark size="l" />
      <h1 className="server-unavailable__title">Trail can’t be reached</h1>
      <p className="muted">{errorMessage(error)}</p>
      <Button variant="primary" icon="refresh" onClick={onRetry} busy={retrying}>
        Try again
      </Button>
    </main>
  );
}
