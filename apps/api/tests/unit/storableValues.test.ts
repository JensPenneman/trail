import { describe, expect, it } from "vitest";
import { deadLetterRecord } from "../../src/overland/deadLetterRecord";
import { countOrNull, nonNegativeRealOrNull, realOrNull } from "../../src/overland/overlandValues";
import { storableJson } from "../../src/overland/storableJson";
import { storableText } from "../../src/overland/storableText";

describe("storableText", () => {
  it("drops NUL characters and replaces lone surrogates, keeping real emoji", () => {
    expect(storableText("a\u0000b")).toBe("ab");
    expect(storableText("\ud800x\udfff")).toBe("�x�");
    expect(storableText("🚲 😀")).toBe("🚲 😀");
  });
});

describe("storableJson", () => {
  it("cleans every string and key, however deep", () => {
    expect(
      storableJson({ "k\u0000": ["\ud800", { deep: "a\u0000" }], n: 1, b: true, z: null }),
    ).toEqual({
      k: ["�", { deep: "a" }],
      n: 1,
      b: true,
      z: null,
    });
  });

  it("cuts off absurd nesting instead of exhausting the stack", () => {
    let nested: unknown = "bottom";
    for (let level = 0; level < 100_000; level += 1) nested = [nested];
    const stored = storableJson(nested);
    expect(JSON.stringify(stored)).toBe(`${"[".repeat(16)}null${"]".repeat(16)}`);
  });
});

describe("deadLetterRecord", () => {
  it("keeps what can be stored and previews large records without splitting a character", () => {
    expect(deadLetterRecord({ wifi: "\u0000" })).toEqual({ wifi: "" });
    // `{"text":"` and 1 990 × "x" put the emoji's first half at index 1 999 of the JSON.
    const large = deadLetterRecord({ text: `${"x".repeat(1_990)}😀${"y".repeat(20_000)}` });
    expect(large).toMatchObject({ truncated: true });
    const preview = (large as { preview: string }).preview;
    expect(preview.isWellFormed()).toBe(true);
    expect(preview.endsWith("�")).toBe(true);
  });
});

describe("numbers for real and integer columns", () => {
  it("keeps float4's range and drops overflow and underflow", () => {
    expect(realOrNull(12.5)).toBe(12.5);
    expect(realOrNull(-0)).toBe(-0);
    expect(realOrNull(3.4e38)).toBe(3.4e38);
    expect(realOrNull(3.5e38)).toBeNull();
    expect(realOrNull(-1e39)).toBeNull();
    expect(realOrNull(1.2e-38)).toBe(1.2e-38);
    expect(realOrNull(1e-39)).toBeNull();
    expect(realOrNull(Number.MIN_VALUE)).toBeNull();
    expect(realOrNull(Number.NaN)).toBeNull();
    expect(nonNegativeRealOrNull(-1)).toBeNull();
    expect(countOrNull(2_147_483_647)).toBe(2_147_483_647);
    expect(countOrNull(2_147_483_648)).toBeNull();
    expect(countOrNull(12.6)).toBe(13);
  });
});
