import { useFormatter } from "../../format/useFormatter";
import { useConfig } from "../../queries/useConfig";
import { useSignOut } from "../../queries/useSignOut";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";

/** Which build is running, and signing out (the only place for it on phones). */
export function AboutSection({ headingId }: { headingId: string }) {
  const format = useFormatter();
  const config = useConfig();
  const signOut = useSignOut();
  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        About
      </h2>
      <div className="card">
        {config.data === undefined ? null : (
          <dl className="facts">
            <div>
              <dt>Version</dt>
              <dd>{config.data.version}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd className="mono">{config.data.commit}</dd>
            </div>
            <div>
              <dt>Built</dt>
              <dd>
                {config.data.builtAt === null
                  ? "Development build"
                  : format.dateTime(config.data.builtAt)}
              </dd>
            </div>
            <div>
              <dt>Receiver endpoint</dt>
              <dd className="mono">{config.data.ingestUrl}</dd>
            </div>
          </dl>
        )}
        {signOut.isError ? <ErrorState title="Signing out failed" error={signOut.error} /> : null}
        <div className="cluster">
          <Button icon="signOut" busy={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        </div>
      </div>
    </section>
  );
}
