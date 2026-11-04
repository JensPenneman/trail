import { screen, within } from "@testing-library/react";
import type { Person, SharedDevice } from "@trail/contracts/person";
import { describe, expect, it } from "vitest";
import { PersonRow } from "../src/pages/people/PersonRow";
import { ana, sharedDevice, user } from "./support/fixtures";
import { renderPage } from "./support/renderPage";

function renderRow(person: Person) {
  renderPage(
    <PersonRow person={person} colorSlot={0} now={Date.now()} liveMinutes={15} to="/?person=ana" />,
    { user },
  );
  return screen.getByRole("link", { name: /^Ana Bell/ });
}

/** Ana's phone as a coarse share has it: the centre of a cell, with the cell size as accuracy. */
function coarse(precision: "approximate" | "area", overrides: Partial<SharedDevice> = {}): Person {
  const location = sharedDevice().location;
  if (location === null) throw new Error("fixture without a location");
  return ana({
    share: { ...ana().share, precision, includeDetails: true },
    devices: [
      sharedDevice({
        location: {
          ...location,
          accuracy: precision === "area" ? 5_600 : 556,
          // An area share drops the speed too.
          speed: precision === "area" ? null : location.speed,
          course: null,
          altitude: null,
          precision,
        },
        distanceM: 3_200,
        ...overrides,
      }),
    ],
  });
}

describe("a row of a coarse share", () => {
  it("says an approximate position is within about 500 m, and its distance about", () => {
    const row = renderRow(coarse("approximate"));
    expect(within(row).getByText("Cycling · 16 km/h · within about 500 m")).toBeInTheDocument();
    const distance = within(row).getByText("3.2 km", { exact: false }).closest("span");
    expect(distance).toHaveTextContent("≈ about 3.2 km");
    expect(within(row).getByRole("img", { name: "Battery 58%" })).toBeInTheDocument();
  });

  it("says an area is within about 5 km, with what they do but no speed", () => {
    const row = renderRow(coarse("area"));
    expect(within(row).getByText("Cycling · within about 5 km")).toBeInTheDocument();
    expect(within(row).getByText("3.2 km", { exact: false }).closest("span")).toHaveTextContent(
      "≈ about 3.2 km",
    );
  });

  it("says only how coarse when nothing else is known, and nothing of it when precise", () => {
    const row = renderRow(coarse("area", { activity: null, battery: null }));
    expect(within(row).getByText("Within about 5 km")).toBeInTheDocument();
    expect(within(row).queryByRole("img", { name: /^Battery/ })).toBeNull();
  });

  it("is one link to the detail, named by what it says in order", () => {
    const row = renderRow(ana());
    expect(row).toHaveAttribute("href", "/?person=ana");
    expect(row).toHaveAccessibleName(
      /^Ana Bell\s+Battery 58%.*Distance from you:\s*1\.8 km.*Cycling\s+·\s+16\s+km\/h$/,
    );
    expect(within(row).queryByRole("heading")).toBeNull();
  });

  it("leaves a precise share's line and distance as they are", () => {
    const row = renderRow(ana());
    expect(within(row).getByText("Cycling · 16 km/h")).toBeInTheDocument();
    expect(within(row).queryByText(/within about/i)).toBeNull();
    expect(within(row).getByText("1.8 km").closest("span")).not.toHaveTextContent("≈");
  });
});
