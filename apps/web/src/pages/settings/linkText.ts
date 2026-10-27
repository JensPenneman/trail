import type { ShareLink } from "@trail/contracts/shareLink";
import type { Formatter } from "../../format/createFormatter";

/** "Not opened yet", "Opened 12 times, last 10 min ago". */
export function linkViewsText(link: ShareLink, format: Formatter, now: number): string {
  return link.viewCount === 0 || link.lastViewedAt === null
    ? "Not opened yet"
    : `Opened ${link.viewCount === 1 ? "once" : `${format.count(link.viewCount)} times`}, last ${format.relative(link.lastViewedAt, now)}`;
}
