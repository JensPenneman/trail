import { expect } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { heatPixels } from "./support/heatPixels";
import { localDate, openMapOptions } from "./support/mapControls";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";
import { walkAndDrive } from "./support/walkAndDrive";

/*
 * Heat's options (docs/architecture.md §14): what the squares count, the period of the stop
 * measures, the key on the map, and the lens an Insights page sets with a link.
 */
test("Heat by time spent: the period appears, the key follows the measure, the chip names the period", async ({
  page,
  account,
}) => {
  // A walk, five minutes standing still and a drive: the stay is what time and visits count.
  await uploadedDevice(page, "Walker", walkAndDrive());
  await page.goto("/?view=heat&person=me&c=3.7335,51.0543,14");
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
  // The stay is drawn: the processing of the upload has made it a stop (it takes a moment). The
  // options are closed first: on a phone they cover the map.
  await page.keyboard.press("Escape");
  await expect(key.getByRole("list")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => heatPixels(page), { timeout: 30_000 }).toBeGreaterThan(0);

  await openMapOptions(page);
  await period.selectOption("30d");
  await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/[?&]to=\d{4}-\d{2}-\d{2}/);
  const chip = page.getByRole("button", { name: "Show all time" });
  await expect(chip).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Time spent at places in each square" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all time" })).toBeVisible();
  await expectAccessible(page, "Heat's chip over the map", { keepScroll: true });

  // The custom period: a form with its mistakes said, then applied.
  await period.selectOption("custom");
  await page.getByRole("textbox", { name: "From" }).fill(localDate(account.timezone, -1));
  await page.getByRole("textbox", { name: "To" }).fill(localDate(account.timezone, -10));
  await page.getByRole("button", { name: "Show period" }).click();
  await expect(page.getByText("From must not be after To.")).toBeVisible();
  await expectAccessible(page, "Heat's custom period with a mistake said", { keepScroll: true });
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

test("the lens an Insights page sets: the camera, the chip, its ✕ in place of its entry, Back to Insights", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Walker", walkAndDrive());
  await page.goto("/insights");
  await expect(page).toHaveURL(/\/insights/);
  const from = localDate(account.timezone, -29);
  const to = localDate(account.timezone, 0);
  const asked = page.waitForRequest((request) => request.url().includes("/api/heatmap?"));
  await page.goto(`/?view=heat&person=me&heat=visits&from=${from}&to=${to}&c=3.7335,51.0543,14`);
  // The map starts at the camera of the link: the cells are asked for at its zoom.
  expect(new URL((await asked).url()).searchParams.get("zoom")).toBe("14");
  const chip = page.getByRole("button", { name: "Show all time" });
  await expect(chip).toBeVisible();
  await expect(page.getByRole("region", { name: "Visits to places in each square" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]c=3\.7335,51\.0543,14/);

  // The first pan frees the address of the camera, in place of its entry.
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("The map has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect(page).not.toHaveURL(/[?&]c=/);
  await expect(page).toHaveURL(/[?&]heat=visits/);

  // ✕ shows all time in place of the entry, and focus goes to the map options.
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Map options" })).toBeFocused();
  await expect(page).not.toHaveURL(/[?&](heat|from|to)=/);
  await expect(page.getByRole("list", { name: "Points recorded in each square" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/insights/);
});

test.describe("the key in each state", () => {
  const states = {
    "while it loads": { delay: 4000, body: null },
    "when nothing is in view": {
      body: {
        heat: "time",
        cellZoom: 15,
        cells: [],
        truncated: false,
        mode: null,
        period: { from: "2026-10-01", to: "2026-10-31" },
        pending: false,
      },
    },
    "while days are worked out": {
      body: {
        heat: "time",
        cellZoom: 15,
        cells: [[16705, 10972, 1200]],
        truncated: false,
        mode: null,
        period: { from: "2026-10-01", to: "2026-10-31" },
        pending: true,
      },
    },
    "when it was cut": {
      body: {
        heat: "time",
        cellZoom: 15,
        cells: [
          [16705, 10972, 1200],
          [16706, 10972, 90],
        ],
        truncated: true,
        mode: null,
        period: { from: "2026-10-01", to: "2026-10-31" },
        pending: false,
      },
    },
    "when the heatmap could not be loaded": {
      status: 500,
      body: { error: { code: "internal", message: "Broken" } },
    },
  } as const;

  for (const [name, state] of Object.entries(states)) {
    test(`is accessible ${name}`, async ({ page, account, consoleGuard }) => {
      // The failure is what is on show; Chrome's line about each try is fine.
      if ("status" in state) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          consoleGuard.expectFailedResponse(500, /\/api\/heatmap\?/);
        }
      }
      await uploadedDevice(page, "Walker", walkAndDrive());
      await page.route("**/api/heatmap?*", async (route) => {
        if ("delay" in state) await new Promise((resolve) => setTimeout(resolve, state.delay));
        await route.fulfill({
          status: "status" in state ? state.status : 200,
          json: state.body ?? {
            heat: "time",
            cellZoom: 15,
            cells: [],
            truncated: false,
            mode: null,
            period: null,
            pending: false,
          },
        });
      });
      await page.goto(
        `/?view=heat&person=me&heat=time&from=${localDate(account.timezone, -29)}&to=${localDate(account.timezone, 0)}`,
      );
      await expect(
        page.getByRole("region", { name: "Time spent at places in each square" }),
      ).toBeVisible();
      await expectAccessible(page, `Heat's key ${name}`);
    });
  }
});

test("Settings › Preferences with the heat and colour rows", async ({ page, account }) => {
  void account;
  await page.goto("/settings/preferences");
  await expect(page.getByRole("combobox", { name: "Heat by" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Colour paths by" })).toBeVisible();
  await expectAccessible(page, "Settings › Preferences");
});
