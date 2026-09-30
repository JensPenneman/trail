import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { emailSchema } from "@trail/contracts/email";
import { type FormEvent, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import type { AuthProblem } from "../../auth/AuthProblem";
import { AuthProblemNotice } from "../../auth/AuthProblemNotice";
import { classifyAuthError } from "../../auth/classifyAuthError";
import { signInWithEmail } from "../../auth/signInWithEmail";
import { useCompleteSignIn } from "../../auth/useCompleteSignIn";
import { useFormatter } from "../../format/useFormatter";
import { useLinkInfo } from "../../queries/useLinkInfo";
import { Button } from "../../ui/Button";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { TextField } from "../../ui/TextField";
import "../login/LoginPage.css";

/** Accepting an invitation: the address (pre-filled when the invite is bound to one) plus a new passkey. */
export function InvitePage() {
  const { token = "" } = useParams();
  const info = useLinkInfo(token);
  const format = useFormatter();
  const completeSignIn = useCompleteSignIn("/");
  const emailRef = useRef<HTMLInputElement>(null);
  const [typedEmail, setTypedEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [supported] = useState(browserSupportsWebAuthn);

  if (info.data?.kind === "passkey")
    return <Navigate to={`/link/${encodeURIComponent(token)}`} replace />;

  const boundEmail = info.data?.kind === "invite" ? info.data.email : null;
  const email = boundEmail ?? typedEmail;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError("Enter your email address, like name@example.com.");
      emailRef.current?.focus();
      return;
    }
    setEmailError(null);
    setProblem(null);
    setWorking(true);
    try {
      const result = await signInWithEmail(parsed.data, token);
      completeSignIn(result.user);
    } catch (error) {
      setProblem(classifyAuthError(error));
      setWorking(false);
    }
  };

  return (
    <div className="login">
      <DocumentTitle title="Accept invitation" />
      <header className="login__header">
        <h1 className="login__title" tabIndex={-1} data-page-title>
          You’re invited
        </h1>
        <p className="muted">
          Create your Trail account. It uses a passkey instead of a password — your browser or
          password manager keeps it for you.
        </p>
      </header>

      {info.isPending ? (
        <LoadingBlock label="Checking the invitation">
          <Skeleton height="1.25rem" width="70%" />
          <Skeleton height="2.75rem" />
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
          {problem === null ? null : <AuthProblemNotice problem={problem} email={email} />}
          <form className="login__form" onSubmit={(event) => void onSubmit(event)} noValidate>
            <TextField
              ref={emailRef}
              label="Email address"
              type="email"
              name="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              readOnly={boundEmail !== null}
              hint={
                boundEmail === null
                  ? "This is how you sign in later."
                  : "This invitation is for this address."
              }
              error={emailError}
              disabled={!supported}
              onChange={(event) => setTypedEmail(event.currentTarget.value)}
            />
            <Button
              type="submit"
              variant="primary"
              wide
              icon="key"
              busy={working}
              disabled={!supported}
            >
              Create account with a passkey
            </Button>
          </form>
          <p className="login__status" role="status">
            {working ? "Follow the prompt from your browser or password manager." : ""}
          </p>
          {info.data === undefined ? null : (
            <p className="login__footnote muted">
              The invitation is valid until {format.dateTime(info.data.expiresAt)}. Already have an
              account? <Link to="/login">Sign in</Link>.
            </p>
          )}
        </>
      )}
    </div>
  );
}
