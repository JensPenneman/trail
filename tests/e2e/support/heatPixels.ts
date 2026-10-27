import type { Page } from "@playwright/test";

/**
 * How many pixels of the map wear the heatmap's colours: what WebGL drew,
 * not what the page handed to MapLibre. The suite's map styles are a plain
 * grey ground (mapStyleStub), and the Heat view draws nothing else, so a pink
 * or purple pixel — red and blue above green — is a heatmap square. The
 * screenshot is decoded in a blank page of the same browser.
 */
export async function heatPixels(page: Page): Promise<number> {
  const png = await page.locator(".maplibregl-canvas").screenshot();
  const decoder = await page.context().newPage();
  try {
    return await decoder.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("No 2D canvas to decode the screenshot");
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index] ?? 0;
        const green = data[index + 1] ?? 0;
        const blue = data[index + 2] ?? 0;
        if (red - green > 25 && blue - green > 10) count += 1;
      }
      return count;
    }, png.toString("base64"));
  } finally {
    await decoder.close();
  }
}
