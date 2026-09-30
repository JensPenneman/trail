import { useMediaQuery } from "./useMediaQuery";

/** Follows the operating system's light/dark setting live (the map style switches with it). */
export function usePrefersDark(): boolean {
  return useMediaQuery("(prefers-color-scheme: dark)");
}
