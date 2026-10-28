/**
 * Why a pull failed, in words that carry no URL, token or path: the log and
 * `trail map refresh` name only this and the message (docs/design/self-hosted-maps.md §7).
 */
export type RegistryFailure =
  /** No connection, or it broke off before an answer. */
  | "unreachable"
  /** No answer, or no data for too long. */
  | "timeout"
  /** An error status (in `status`). */
  | "status"
  /** The registry refused the credentials, or an anonymous pull. */
  | "denied"
  /** No such tag (an unknown region) or blob. */
  | "not_found"
  /** More than a bound allows: an answer, a file, a build, or the free disk space. */
  | "too_large"
  /** An answer or an artefact that is not what Trail publishes. */
  | "malformed"
  /** A redirect or a token service on a host Trail does not talk to. */
  | "host"
  /** Bytes whose SHA-256 is not the digest they were asked for by. */
  | "digest"
  /** A download that ended early, again and again. */
  | "truncated"
  /** The volume refused a write. */
  | "disk";

/** A pull that failed; `retryable` when another attempt may succeed (a busy or unreachable registry). */
export class RegistryError extends Error {
  readonly reason: RegistryFailure;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { reason: RegistryFailure; status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RegistryError";
    this.reason = options.reason;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Statuses worth another attempt: the registry is busy or failing for a moment. */
export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;
