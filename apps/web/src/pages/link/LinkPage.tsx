import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import type { AuthProblem } from "../../auth/AuthProblem";
import { AuthProblemNotice } from "../../auth/AuthProblemNotice";
import { addPasskeyWithLink } from "../../auth/addPasskeyWithLink";
import { classifyAuthError } from "../../auth/classifyAuthError";
import { useCompleteSignIn } from "../../auth/useCompleteSignIn";
import { useFormatter } from "../../format/useFormatter";
import { useLinkInfo } from "../../queries/useLinkInfo";
import { Button } from "../../ui/Button";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import "../login/LoginPage.css";

/**
 * A one-time link (from Settings or the server's `trail passkey-link` command)
 * that adds a passkey for this web address to an existing account.
 */
export function LinkPage() {
  const { token = "" } = useParams();
  const info = useLinkInfo(token);
  const format = useFormatter();
  const completeSignIn = useCompleteSignIn("/");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [supported] = useState(browserSupportsWebAuthn);

  if (info.data?.kind === "invite")
    return <Navigate to={`/invite/${encodeURIComponent(token)}`} replace />;

  const create = async () => {
    setProblem(null);
    setWorking(true);
    try {
      const result = await addPasskeyWithLink(token);
      completeSignIn(result.user);
    } catch (error) {
      setProblem(classifyAuthError(error));
      setWorking(false);
    }
  };

  return (
    <div className="login">
      <DocumentTitle title="Add a passkey" />
      <header className="login__header">
        <h1 className="login__title" tabIndex={-1} data-page-title>
          Add a passkey
        </h1>
        <p className="muted">
          Passkeys belong to one web address. This one will let you sign in at{" "}
          <strong>{window.location.host}</strong>.
        </p>
      </header>

      {info.isPending ? (
        <LoadingBlock label="Checking the link">
          <Skeleton height="1.25rem" width="80%" />
          <Skeleton height="2.75rem" />
        </LoadingBlock>
      ) : info.isError ? (
        <>
          <AuthProblemNotice problem={classifyAuthError(info.error)} />
          <p>
            <Link to="/login">Go to sign in</Link>
          </p>
        </>
      ) : (
        <>
          {supported ? null : <AuthProblemNotice problem={{ kind: "unsupported" }} />}
          {problem === null ? null : <AuthProblemNotice problem={problem} />}
          {info.data === undefined ? null : (
            <p>
              For the account <strong>{info.data.email}</strong>. Your browser or password manager
              will ask where to keep the new passkey; signing in happens right after.
            </p>
          )}
          <Button
            variant="primary"
            wide
            icon="key"
            busy={working}
            disabled={!supported}
            onClick={() => void create()}
          >
            Create passkey and sign in
          </Button>
          <p className="login__status" role="status">
            {working ? "Follow the prompt from your browser or password manager." : ""}
          </p>
          {info.data === undefined ? null : (
            <p className="login__footnote muted">
              The link works once and expires {format.dateTime(info.data.expiresAt)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
