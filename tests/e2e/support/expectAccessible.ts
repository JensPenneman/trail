import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/*
 * WCAG 2.0 A to AAA, 2.1 A/AA and 2.2 AA — every level axe has rules for —
 * and axe's best practices. A failing rule means a fix in the app, never an
 * exclusion here.
 */
const tags = ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Scans the page as it is now. Opening transitions (dialogs fade in) are
 * awaited first: halfway through, the text is paler than it will be.
 */
export async function expectAccessible(
  page: Page,
  what: string,
  { keepScroll = false }: { keepScroll?: boolean } = {},
): Promise<void> {
  // On phones the page is scanned with the sheet at its peek, as a person first sees it: a sheet
  // that happens to be half lifted covers the map's controls and the header's links partly. The
  // scroll is put back afterwards, so the scan changes nothing for the steps that follow.
  const before = await page.evaluate(() => window.scrollY);
  if (!keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  const violations = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? ""}`),
  }));
  if (!keepScroll && before > 0) await page.evaluate((y) => window.scrollTo(0, y), before);
  expect(violations, `accessibility of ${what}`).toEqual([]);
}
