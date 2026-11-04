import { createContext, useContext, useEffect } from "react";

/** Lets a page ask for the offline banner to stay under the header while the page scrolls. */
export const StickyBannerContext = createContext<(sticky: boolean) => void>(() => undefined);

/**
 * The People page floats its map under the header and the banner, so for that
 * page alone the banner is sticky and its height is published
 * (`--banner-height`); other pages keep the banner in the page's flow.
 */
export function useStickyBanner(): void {
  const set = useContext(StickyBannerContext);
  useEffect(() => {
    set(true);
    return () => set(false);
  }, [set]);
}
