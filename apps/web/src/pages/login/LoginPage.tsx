import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { emailSchema } from "@trail/contracts/email";
import { type FormEvent, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import { safeNextPath } from "../../app/safeNextPath";
import type { AuthProblem } from "../../auth/AuthProblem";
import { AuthProblemNotice } from "../../auth/AuthProblemNotice";
import { classifyAuthError } from "../../auth/classifyAuthError";
import { signInWithEmail } from "../../auth/signInWithEmail";
import { signInWithPasskey } from "../../auth/signInWithPasskey";
import { useCompleteSignIn } from "../../auth/useCompleteSignIn";
import { useConditionalSignIn } from "../../auth/useConditionalSignIn";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import "./LoginPage.css";

type Working = "email" | "passkey" | null;

/**
 * One email field and Continue: the server decides between signing in and
 * signing up. Saved passkeys are also offered in the field's autofill, and
 * "Use a passkey" opens the browser's passkey picker directly.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const completeSignIn = useCompleteSignIn(next);
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [working, setWorking] = useState<Working>(null);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [supported] = useState(browserSupportsWebAuthn);

  useConditionalSignIn({
    enabled: supported && working === null,
    inputRef: emailRef,
    onSignedIn: completeSignIn,
    onProblem: setProblem,
  });

  const run = async (
    kind: Exclude<Working, null>,
    ceremony: () => ReturnType<typeof signInWithPasskey>,
  ) => {
    setWorking(kind);
    setProblem(null);
    try {
      const result = await ceremony();
      completeSignIn(result.user);
    } catch (error) {
      setProblem(classifyAuthError(error));
      setWorking(null);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError("Enter your email address, like name@example.com.");
      emailRef.current?.focus();
      return;
    }
    setEmailError(null);
    void run("email", () => signInWithEmail(parsed.data));
  };

  return (
    <div className="login">
      <DocumentTitle title="Sign in" />
      <header className="login__header">
        <h1 className="login__title" tabIndex={-1} data-page-title>
          Sign in
        </h1>
        <p className="muted">
          With the passkey on this device, your phone or your password manager.
        </p>
      </header>

      {supported ? null : <AuthProblemNotice problem={{ kind: "unsupported" }} />}
      {problem === null ? null : <AuthProblemNotice problem={problem} email={email} />}

      <form className="login__form" onSubmit={onSubmit} noValidate>
        <TextField
          ref={emailRef}
          label="Email address"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="username webauthn"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          error={emailError}
          disabled={!supported}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="primary"
          wide
          busy={working === "email"}
          disabled={!supported || working === "passkey"}
        >
          Continue
        </Button>
      </form>

      <div className="login__divider" aria-hidden="true">
        <span>or</span>
      </div>

      <Button
        icon="key"
        wide
        busy={working === "passkey"}
        disabled={!supported || working === "email"}
        onClick={() => void run("passkey", () => signInWithPasskey())}
      >
        Use a passkey
      </Button>

      <p className="login__status" role="status">
        {working === null ? "" : "Follow the prompt from your browser or password manager."}
      </p>

      <p className="login__footnote muted">
        New to this server? Enter your address: if it is on the server’s list you can create an
        account right away; otherwise open the invite link you were sent.
      </p>
    </div>
  );
}
