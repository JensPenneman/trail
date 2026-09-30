import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "../src/ui/Button";
import { Dialog } from "../src/ui/Dialog";

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Rename</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Rename device">
        <input aria-label="Name" data-autofocus />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("focuses its first field and gives focus back to the opener", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Rename" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Rename device" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
