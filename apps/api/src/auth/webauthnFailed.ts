import { HttpError } from "../http/httpError";

export const webauthnFailed = (
  message = "The passkey could not be verified. Please try again.",
): HttpError => new HttpError(400, "webauthn_failed", message);
