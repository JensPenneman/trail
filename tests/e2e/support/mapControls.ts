import { expect, type Page } from "@playwright/test";

/**
 * The map's options (people, devices, style, level): always open beside a
 * full-height map, folded into one button on phones — opened here if so.
 */
export async function openMapOptions(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /^Map options/ });
  // The button where the options fold away, else the options themselves: the page is there.
  await expect(toggle.or(page.getByRole("group", { name: "Map style" })).first()).toBeVisible();
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}

/** One of Live · History · Heat. */
export function mapView(page: Page, name: "Live" | "History" | "Heat") {
  return page.getByRole("group", { name: "Map view" }).getByRole("radio", { name });
}

/** A local date `YYYY-MM-DD` in `timeZone`, `days` from today. */
export function localDate(timeZone: string, days = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(Date.now() + days * 86_400_000);
}
