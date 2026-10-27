import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { openedFrom } from "./openedFrom";

/**
 * Leaves a page for the one above it once what it showed is gone (a deleted
 * passkey): back in the browser's history when it was opened from there, so
 * Back does not lead to the page of something that no longer exists;
 * otherwise in its place.
 */
export function useLeaveTo(path: string): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const cameFrom = openedFrom(state, path);
  return useCallback(() => {
    if (cameFrom) void navigate(-1);
    else void navigate(path, { replace: true });
  }, [cameFrom, navigate, path]);
}
