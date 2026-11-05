import { act, renderHook } from "@testing-library/react";
import type { SessionUser } from "@trail/contracts/user";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { SessionUserContext } from "../src/app/SessionUserContext";
import { forgetHeatChoice, useHeatChoice } from "../src/pages/map/heat/useHeatChoice";
import { user } from "./support/fixtures";

const withPreference = (heat: "points" | "time" | "visits"): SessionUser => ({
  ...user,
  preferences: { ...user.preferences, heat },
});

function render(path: string, account: SessionUser | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
      <SessionUserContext.Provider value={account}>{children}</SessionUserContext.Provider>
    </MemoryRouter>
  );
  return renderHook(() => ({ choice: useHeatChoice(), location: useLocation() }), { wrapper });
}

afterEach(() => window.localStorage.clear());

describe("useHeatChoice", () => {
  it("takes the address first, then this browser's choice, then the preference, then points", () => {
    expect(render("/?heat=visits", withPreference("time")).result.current.choice.heat).toBe(
      "visits",
    );
    window.localStorage.setItem("trail.heat", "time");
    expect(render("/", withPreference("visits")).result.current.choice.heat).toBe("time");
    forgetHeatChoice();
    expect(render("/", withPreference("visits")).result.current.choice.heat).toBe("visits");
    expect(render("/", null).result.current.choice.heat).toBe("points");
  });

  it("writes a choice into the address in place of its entry, and remembers it", () => {
    const { result } = render("/?view=heat&date=2026-10-20", null);
    act(() => result.current.choice.setHeat("time"));
    expect(result.current.choice.heat).toBe("time");
    expect(new URLSearchParams(result.current.location.search).get("heat")).toBe("time");
    expect(new URLSearchParams(result.current.location.search).get("date")).toBe("2026-10-20");
    expect(window.localStorage.getItem("trail.heat")).toBe("time");
  });

  it("ignores a remembered value it does not know", () => {
    window.localStorage.setItem("trail.heat", "sped");
    expect(render("/", null).result.current.choice.heat).toBe("points");
  });
});
