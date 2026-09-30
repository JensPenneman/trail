import { Notice } from "../ui/Notice";
import type { AuthProblem } from "./AuthProblem";

interface AuthProblemNoticeProps {
  problem: AuthProblem;
  /** The address being signed in, when known. */
  email?: string;
}

/** Explains a failed ceremony and what to do next. */
export function AuthProblemNotice({ problem, email }: AuthProblemNoticeProps) {
  const host = window.location.host;
  const who = email === undefined || email === "" ? "This address" : email;
  switch (problem.kind) {
    case "cancelled":
      return (
        <Notice tone="warning" role="alert" title="No passkey was used">
          <p>The request was cancelled or timed out. Try again when you’re ready.</p>
        </Notice>
      );
    case "unsupported":
      return (
        <Notice tone="warning" role="alert" title="This browser can’t use passkeys">
          <p>
            Open Trail in a current version of Safari, Chrome, Edge or Firefox — on this device or
            another one that holds your passkey.
          </p>
        </Notice>
      );
    case "insecure_origin":
      return (
        <Notice tone="warning" role="alert" title="Passkeys need a secure address">
          <p>
            Browsers only allow passkeys over HTTPS or on localhost. Open Trail at its HTTPS address
            instead of {host}.
          </p>
        </Notice>
      );
    case "signup_not_allowed":
      return (
        <Notice tone="warning" role="alert" title="New accounts need an invitation">
          <p>
            {who} has no account on this server, and it only accepts new people with an invite. Ask
            whoever runs this Trail server for an invite link.
          </p>
        </Notice>
      );
    case "no_passkey_for_origin":
      return (
        <Notice tone="warning" role="alert" title={`No passkey for ${host} yet`}>
          <p>
            {who} has an account, but none of its passkeys belong to this address — a passkey only
            works on the web address it was created for.
          </p>
          <p>
            Ask for a sign-in link: on a device where you are signed in, open Settings → “Add a
            passkey on another device or address”, or ask the server’s admin to create one.
          </p>
        </Notice>
      );
    case "unknown_credential":
      return (
        <Notice tone="warning" role="alert" title="That passkey no longer works here">
          <p>
            It was removed from your account. Your browser has been asked to forget it. Choose
            another passkey, or continue with your email address.
          </p>
        </Notice>
      );
    case "expired":
      return (
        <Notice tone="warning" role="alert" title="The request expired">
          <p>Passkey requests are valid for five minutes. Try again.</p>
        </Notice>
      );
    case "already_registered":
      return (
        <Notice tone="warning" role="alert" title="You already have a passkey here">
          <p>
            This password manager already holds a passkey for the account. Sign in with it instead
            of creating another one.
          </p>
        </Notice>
      );
    case "rate_limited":
      return (
        <Notice tone="warning" role="alert" title="Too many attempts">
          <p>Wait a minute, then try again.</p>
        </Notice>
      );
    case "link_invalid":
      return (
        <Notice tone="danger" role="alert" title="This link can’t be used">
          <p>It is incomplete, was already used, or has expired. Ask for a new one.</p>
        </Notice>
      );
    case "network":
      return (
        <Notice tone="danger" role="alert" title="Trail can’t be reached">
          <p>{problem.message}</p>
        </Notice>
      );
    case "failed":
      return (
        <Notice tone="danger" role="alert" title="That didn’t work">
          <p>{problem.message}</p>
        </Notice>
      );
  }
}
