import { expect } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { localDate, openMapOptions } from "./support/mapControls";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/*
 * Heat's options (docs/architecture.md §14): what the squares count, the period of the stop
 * measures, the key on the map, and the lens an Insights page sets with a link.
 */
test("Heat by time spent: the period appears, the key follows the measure, the chip names the period", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Walker", overlandBatch(account.timezone));
  await page.goto("/?view=heat&person=me");
  await expect(page.getByRole("list", { name: "Points recorded in each square" })).toBeVisible();

  await openMapOptions(page);
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Heat by" }).selectOption("time");
  await expect(page).toHaveURL(/[?&]heat=time/);
  const period = page.getByRole("combobox", { name: "Period" });
  await expect(period).toHaveValue("all");
  // The key is that of the measure, with what it covers; the map is described by it.
  const key = page.getByRole("region", { name: "Time spent at places in each square" });
  await expect(key).toBeVisible();
  await expect(key.getByText(/^Since /)).toBeVisible();
  await expect(
    page.getByRole("region", { name: /^Heatmap of time spent at places/ }),
  ).toHaveAttribute("aria-describedby", (await key.getAttribute("id")) ?? "");
  await expectAccessible(page, "Heat's options and key");

  await period.selectOption("30d");
  await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/[?&]to=\d{4}-\d{2}-\d{2}/);
  const chip = page.getByRole("button", { name: "Show all time" });
  await expect(chip).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Time spent at places in each square" })
      .or(page.getByText("Nothing in view for this period")),
  ).toBeVisible();

  // The custom period: a form with its mistakes said, then applied.
  await period.selectOption("custom");
  await page.getByRole("textbox", { name: "From" }).fill(localDate(account.timezone, -1));
  await page.getByRole("textbox", { name: "To" }).fill(localDate(account.timezone, -10));
  await page.getByRole("button", { name: "Show period" }).click();
  await expect(page.getByText("From must not be after To.")).toBeVisible();
  await page.getByRole("textbox", { name: "From" }).fill(localDate(account.timezone, -10));
  await page.getByRole("textbox", { name: "To" }).fill(localDate(account.timezone, -1));
  await page.getByRole("button", { name: "Show period" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${localDate(account.timezone, -10)}`));

  // Points are all time again: no period, no chip.
  await page.getByRole("combobox", { name: "Heat by" }).selectOption("points");
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show all time" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Points recorded in each square" })).toBeVisible();
});

test("the lens an Insights page sets: the chip, its ✕ in place of its entry, Back to Insights", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Walker", overlandBatch(account.timezone));
  await page.goto("/insights");
  await expect(page).toHaveURL(/\/insights/);
  const from = localDate(account.timezone, -29);
  const to = localDate(account.timezone, 0);
  await page.goto(`/?view=heat&person=me&heat=visits&from=${from}&to=${to}&c=3.5335,50.985,13`);
  const chip = page.getByRole("button", { name: "Show all time" });
  await expect(chip).toBeVisible();
  await expect(page.getByRole("region", { name: "Visits to places in each square" })).toBeVisible();

  // ✕ shows all time in place of the entry: Back still returns to Insights.
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&](heat|from|to)=/);
  await expect(page.getByRole("list", { name: "Points recorded in each square" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/insights/);
});
