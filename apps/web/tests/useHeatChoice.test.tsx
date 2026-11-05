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

  it("takes a mode from the address for the movement measures only, and does not remember it", () => {
    expect(render("/?heat=moving&mode=car", null).result.current.choice.mode).toBe("car");
    expect(render("/?heat=speed&mode=cycling", null).result.current.choice.mode).toBe("cycling");
    // Points, time and visits have no mode; a name that is no mode is none.
    expect(render("/?heat=points&mode=car", null).result.current.choice.mode).toBeNull();
    expect(render("/?heat=topspeed&mode=hovercraft", null).result.current.choice.mode).toBeNull();
    const { result } = render("/?heat=moving&date=2026-10-20", null);
    act(() => result.current.choice.setMode("train"));
    expect(new URLSearchParams(result.current.location.search).get("mode")).toBe("train");
    expect(new URLSearchParams(result.current.location.search).get("date")).toBe("2026-10-20");
    expect(result.current.choice.mode).toBe("train");
    act(() => result.current.choice.setMode(null));
    expect(new URLSearchParams(result.current.location.search).has("mode")).toBe(false);
    expect(window.localStorage.getItem("trail.mode")).toBeNull();
  });

  it("ignores a remembered value it does not know", () => {
    window.localStorage.setItem("trail.heat", "sped");
    expect(render("/", null).result.current.choice.heat).toBe("points");
  });
});
