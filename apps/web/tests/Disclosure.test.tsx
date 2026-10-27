import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DisclosureButton } from "../src/ui/DisclosureButton";
import { DisclosureContent } from "../src/ui/DisclosureContent";
import { useDisclosure } from "../src/ui/useDisclosure";

/** A card's way of using it: the button in a row of actions, what it opens below. */
function Card() {
  const details = useDisclosure();
  return (
    <article aria-labelledby="name">
      <h3 id="name">Ana Bell</h3>
      <button type="button">Show on map</button>
      <DisclosureButton disclosure={details} describedBy="name">
        Details
      </DisclosureButton>
      <DisclosureContent disclosure={details}>
        <a href="https://maps.apple.com/">Apple Maps</a>
      </DisclosureContent>
      <button type="button">After the card</button>
    </article>
  );
}

describe("a disclosure", () => {
  it("is closed at first: the button says so and nothing of it is there to reach", () => {
    render(<Card />);
    const button = screen.getByRole("button", { name: "Details" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleDescription("Ana Bell");
    const controlled = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(controlled).not.toBeNull();
    expect(controlled).not.toBeVisible();
    expect(screen.queryByRole("link", { name: "Apple Maps" })).toBeNull();
  });

  it("opens and closes with a click or the keyboard, its content next in the tab order", async () => {
    const user = userEvent.setup();
    render(<Card />);
    const button = screen.getByRole("button", { name: "Details" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const link = screen.getByRole("link", { name: "Apple Maps" });
    expect(document.getElementById(button.getAttribute("aria-controls") ?? "")).toContainElement(
      link,
    );
    await user.tab();
    expect(link).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After the card" })).toHaveFocus();

    // Enter and Space work as on any button.
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Apple Maps" })).toBeNull();
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.tab();
    expect(screen.getByRole("link", { name: "Apple Maps" })).toHaveFocus();
  });
});
