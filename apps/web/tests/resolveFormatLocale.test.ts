import { describe, expect, it } from "vitest";
import { resolveFormatLocale } from "../src/format/resolveFormatLocale";

describe("resolveFormatLocale", () => {
  it("uses the first English preference as it is", () => {
    expect(resolveFormatLocale(["nl-BE", "en-US", "en"])).toBe("en-US");
  });

  it("pairs English with the region of a non-English preference", () => {
    expect(resolveFormatLocale(["nl-BE", "nl"])).toBe("en-BE");
    expect(resolveFormatLocale(["de"])).toBe("en-DE");
  });

  it("falls back to British English", () => {
    expect(resolveFormatLocale([])).toBe("en-GB");
    expect(resolveFormatLocale(["not a tag!"])).toBe("en-GB");
  });
});
