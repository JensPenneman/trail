import { screen, within } from "@testing-library/react";
import type { Person, SharedDevice } from "@trail/contracts/person";
import { describe, expect, it } from "vitest";
import { PersonCard } from "../src/people/PersonCard";
import { ana, sharedDevice, user } from "./support/fixtures";
import { renderPage } from "./support/renderPage";

const noop = () => undefined;

function renderCard(person: Person) {
  renderPage(
    <PersonCard
      person={person}
      colorSlot={0}
      now={Date.now()}
      liveMinutes={15}
      sharesBack={false}
      onShowOnMap={noop}
      onShareBack={noop}
      onHide={noop}
    />,
    { user },
  );
  return screen.getByRole("article", { name: "Ana Bell" });
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

describe("a card of a coarse share", () => {
  it("says an approximate position is within about 500 m, and its distance about", () => {
    const card = renderCard(coarse("approximate"));
    expect(within(card).getByText("Cycling · 16 km/h · within about 500 m")).toBeInTheDocument();
    const distance = within(card).getByText("3.2 km", { exact: false }).closest("span");
    expect(distance).toHaveTextContent("≈ about 3.2 km");
    expect(within(card).getByRole("img", { name: "Battery 58%" })).toBeInTheDocument();
  });

  it("says an area is within about 5 km, with what they do but no speed", () => {
    const card = renderCard(coarse("area"));
    expect(within(card).getByText("Cycling · within about 5 km")).toBeInTheDocument();
    expect(within(card).getByText("3.2 km", { exact: false }).closest("span")).toHaveTextContent(
      "≈ about 3.2 km",
    );
  });

  it("says only how coarse when nothing else is known, and nothing of it when precise", () => {
    const card = renderCard(coarse("area", { activity: null, battery: null }));
    expect(within(card).getByText("Within about 5 km")).toBeInTheDocument();
    expect(within(card).queryByRole("img", { name: /^Battery/ })).toBeNull();
  });

  it("leaves a precise share's line and distance as they are", () => {
    const card = renderCard(ana());
    expect(within(card).getByText("Cycling · 16 km/h")).toBeInTheDocument();
    expect(within(card).queryByText(/within about/i)).toBeNull();
    expect(within(card).getByText("1.8 km").closest("span")).not.toHaveTextContent("≈");
  });
});
