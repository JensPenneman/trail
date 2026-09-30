import type { Locator, Page } from "@playwright/test";

/** A device's card on the Live page (an article named after the device). */
export function deviceCard(page: Page, name: string): Locator {
  return page.getByRole("article", { name });
}

/** The value next to a label in a card's or page's facts (`<dt>` / `<dd>`). */
export function fact(scope: Locator, label: string): Locator {
  return scope
    .locator("dl > div")
    .filter({ has: scope.page().getByText(label, { exact: true }) })
    .locator("dd");
}
