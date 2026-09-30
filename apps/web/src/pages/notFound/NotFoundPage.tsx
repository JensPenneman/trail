import { DocumentTitle } from "../../app/DocumentTitle";
import { PublicBackdrop } from "../../app/PublicBackdrop";
import { LinkButton } from "../../ui/LinkButton";
import { Wordmark } from "../../ui/Wordmark";
import "./NotFoundPage.css";

export function NotFoundPage() {
  return (
    <main className="not-found">
      <DocumentTitle title="Page not found" />
      <PublicBackdrop />
      <Wordmark size="l" />
      <h1 className="not-found__title" tabIndex={-1} data-page-title>
        This trail goes nowhere
      </h1>
      <p className="muted">
        There is no page at this address. It may have moved, or the link is incomplete.
      </p>
      <LinkButton to="/" variant="primary" icon="live">
        Go to Live
      </LinkButton>
    </main>
  );
}
