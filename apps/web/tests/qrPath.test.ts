import { describe, expect, it } from "vitest";
import { qrPath } from "../src/ui/qrPath";

describe("qrPath", () => {
  it("draws one rectangle per run of dark modules", () => {
    expect(
      qrPath(
        [
          [true, true, false],
          [false, true, true],
        ],
        4,
      ),
    ).toBe("M4 4h2v1h-2zM5 5h2v1h-2z");
  });
});
