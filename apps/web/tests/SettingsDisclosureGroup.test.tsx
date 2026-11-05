import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SettingsDisclosureGroup } from "../src/settings/SettingsDisclosureGroup";

function Group({ level }: { level?: "h2" | "h3" }) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsDisclosureGroup
      title="Summary"
      open={open}
      onOpenChange={setOpen}
      {...(level === undefined ? {} : { titleAs: level })}
    >
      <p>What it holds</p>
    </SettingsDisclosureGroup>
  );
}

describe("SettingsDisclosureGroup", () => {
  it("is a heading with a button inside, closed, and renders nothing of its content", () => {
    render(<Group />);
    const heading = screen.getByRole("heading", { level: 3, name: "Summary" });
    const button = screen.getByRole("button", { name: "Summary" });
    expect(heading).toContainElement(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls");
    expect(screen.queryByText("What it holds")).toBeNull();
  });

  it("opens and closes with its button, the content only while open", async () => {
    const user = userEvent.setup();
    render(<Group />);
    const button = screen.getByRole("button", { name: "Summary" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const content = screen.getByText("What it holds");
    expect(content.closest("div")).toHaveAttribute("id", button.getAttribute("aria-controls"));
    await user.click(button);
    expect(screen.queryByText("What it holds")).toBeNull();
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Group />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByText("What it holds")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.queryByText("What it holds")).toBeNull();
  });

  it("takes the heading level it is given", () => {
    render(<Group level="h2" />);
    expect(screen.getByRole("heading", { level: 2, name: "Summary" })).toBeInTheDocument();
  });
});
