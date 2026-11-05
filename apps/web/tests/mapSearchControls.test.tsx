import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";
import { describe, expect, it } from "vitest";
import { SessionUserContext } from "../src/app/SessionUserContext";
import { useMapSearch } from "../src/pages/map/useMapSearch";
import { user } from "./support/fixtures";

function render(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionUserContext.Provider value={user}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </SessionUserContext.Provider>
  );
  return renderHook(
    () => ({ controls: useMapSearch(), type: useNavigationType(), at: useLocation() }),
    { wrapper },
  );
}

describe("what Heat's controls do to the history", () => {
  it("makes a step of a period, in its own entry, keeping the day", () => {
    const { result } = render("/?view=heat&date=2026-10-20");
    act(() => result.current.controls.setHeatPeriod({ from: "2026-10-01", to: "2026-10-31" }));
    expect(result.current.type).toBe("PUSH");
    expect(result.current.at.search).toBe(
      "?view=heat&date=2026-10-20&from=2026-10-01&to=2026-10-31",
    );
    act(() => result.current.controls.setHeatPeriod(null));
    expect(result.current.type).toBe("PUSH");
    expect(result.current.at.search).toBe("?view=heat&date=2026-10-20");
  });

  it("takes the lens off and releases the camera in place of their entry", () => {
    const { result } = render("/?view=heat&heat=time&from=2026-10-01&to=2026-10-31&c=3.7,51,12");
    act(() => result.current.controls.releaseCamera());
    expect(result.current.type).toBe("REPLACE");
    expect(new URLSearchParams(result.current.at.search).has("c")).toBe(false);
    act(() => result.current.controls.clearLens());
    expect(result.current.type).toBe("REPLACE");
    expect(result.current.at.search).toBe("?view=heat");
  });

  it("leaves the address alone when there is no camera to release", () => {
    const { result } = render("/?view=heat");
    const before = result.current.at.key;
    act(() => result.current.controls.releaseCamera());
    expect(result.current.at.key).toBe(before);
  });
});
