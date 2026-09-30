import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "../ui/Button";
import { Wordmark } from "../ui/Wordmark";
import { DocumentTitle } from "./DocumentTitle";
import { isChunkLoadError } from "./isChunkLoadError";
import "./RouteError.css";

/** Last-resort screen when rendering a route throws. */
export function RouteError() {
  const error = useRouteError();
  const updated = isChunkLoadError(error);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = updated
    ? "Trail was updated"
    : notFound
      ? "Page not found"
      : "Something went wrong";
  return (
    <main className="route-error">
      <DocumentTitle title={title} />
      <Wordmark size="l" />
      <h1 className="route-error__title">{title}</h1>
      <p className="muted">
        {updated
          ? "A new version is available. Reload to continue with it."
          : notFound
            ? "There is nothing at this address."
            : "This screen ran into an unexpected problem. Reloading usually helps."}
      </p>
      <div className="cluster route-error__actions">
        <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Link to="/">Go to Live</Link>
      </div>
    </main>
  );
}
