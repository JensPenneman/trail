import type { Page } from "@playwright/test";

/**
 * How many pixels of the map are (nearly) each of the given colours, `#rrggbb`: what WebGL drew,
 * not what the page handed to MapLibre. The suite's basemap has tiles of Monaco only, so where the
 * tests' tracks are the map is the style's plain ground and a line's colour is the only one there.
 * The screenshot is decoded in a blank page of the same browser; `tolerance` is per channel, for
 * the lines' anti-aliased edges.
 */
export async function linePixels(
  page: Page,
  colours: readonly string[],
  tolerance = 12,
): Promise<number[]> {
  const png = await page.locator(".maplibregl-canvas").screenshot();
  const decoder = await page.context().newPage();
  try {
    return await decoder.evaluate(
      async ({ base64, wanted, margin }) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("No 2D canvas to decode the screenshot");
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const targets = wanted.map((hex) => {
          const value = Number.parseInt(hex.slice(1), 16);
          return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
        });
        const counts = targets.map(() => 0);
        for (let index = 0; index < data.length; index += 4) {
          const red = data[index] ?? 0;
          const green = data[index + 1] ?? 0;
          const blue = data[index + 2] ?? 0;
          targets.forEach(([r, g, b], target) => {
            if (
              Math.abs(red - r) <= margin &&
              Math.abs(green - g) <= margin &&
              Math.abs(blue - b) <= margin
            ) {
              counts[target] = (counts[target] ?? 0) + 1;
            }
          });
        }
        return counts;
      },
      { base64: png.toString("base64"), wanted: [...colours], margin: tolerance },
    );
  } finally {
    await decoder.close();
  }
}
