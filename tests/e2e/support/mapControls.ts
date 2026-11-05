import { expect, type Page } from "@playwright/test";

/**
 * The map's options (style, detail of the tracks, devices): a popover that
 * opens from the "Map options" button over the map — opened here if closed.
 * A press outside closes it, so reopen it after touching the map.
 */
export async function openMapOptions(page: Page): Promise<void> {
  // On phones a lifted sheet covers the bar: lower it, as a person would.
  await page.evaluate(() => window.scrollTo(0, 0));
  const toggle = page.getByRole("button", { name: "Map options" });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(page.getByRole("group", { name: "Map style" })).toBeVisible();
}

/** The map's device filter: in Map options, folded under Advanced — opened here if need be. */
export async function openDeviceFilter(page: Page): Promise<void> {
  await openMapOptions(page);
  const advanced = page.locator("details", { has: page.getByText("Advanced", { exact: true }) });
  if ((await advanced.getAttribute("open")) === null) {
    await advanced.getByText("Advanced", { exact: true }).click();
  }
  await expect(page.getByRole("group", { name: "Devices" })).toBeVisible();
}

/** One of Live · History · Heat. */
export function mapView(page: Page, name: "Live" | "History" | "Heat") {
  return page.getByRole("group", { name: "Map view" }).getByRole("radio", { name });
}

/** A local date `YYYY-MM-DD` in `timeZone`, `days` from today. */
export function localDate(timeZone: string, days = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(Date.now() + days * 86_400_000);
}

/** History's date button over the map, with its popover opened (the day or period choice). */
export async function openPeriodPicker(page: Page): Promise<void> {
  // The sheet at its peek and staying there: a page that has just loaded may still restore the
  // scroll it had (after a reload) a moment after it is lowered.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      return page.evaluate(
        () =>
          new Promise<number>((done) => {
            let frames = 0;
            const next = () =>
              ++frames >= 10 ? done(window.scrollY) : requestAnimationFrame(next);
            requestAnimationFrame(next);
          }),
      );
    })
    .toBe(0);
  const date = page.getByRole("button", { name: /, choose another day$/ });
  await expect(date).toBeVisible();
  if ((await date.getAttribute("aria-expanded")) === "false") await date.click();
  await expect(page.getByRole("group", { name: "Show one day or a period" })).toBeVisible();
}

/**
 * A folded group of a person's page ("Summary, visits and trips", "Heat: totals, busiest places",
 * "Summary", a person's devices): its button, pressed if the group is closed.
 */
export async function openGroup(page: Page, name: string | RegExp): Promise<void> {
  const button = page.getByRole("button", {
    name,
    ...(typeof name === "string" ? { exact: true } : {}),
  });
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

/** Shows one of Live · History · Heat: on phones the sheet is lowered first, as it covers the bar. */
export async function showView(page: Page, name: "Live" | "History" | "Heat"): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await mapView(page, name).click();
}

/** Closes the map options popover (Escape, as a keyboard user does), so it no longer covers the sheet. */
export async function closeMapOptions(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /^Map options/ });
  if ((await toggle.getAttribute("aria-expanded")) === "true") await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
}
