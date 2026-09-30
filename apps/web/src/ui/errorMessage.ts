import { ApiError } from "../api/ApiError";

/** A sentence to show for any failure: the API's own message when there is one. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Try again.";
}
