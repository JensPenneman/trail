import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeviceFilter } from "../src/pages/map/DeviceFilter";

const groups = [
  {
    key: "me",
    name: "Me",
    devices: [
      { id: "phone", name: "Phone", slot: 0, palette: "device" as const },
      { id: "car", name: "Car", slot: 1, palette: "device" as const },
    ],
  },
];

describe("the device filter", () => {
  it("applies a press at once, before the address has caught up", async () => {
    const onChange = vi.fn();
    render(<DeviceFilter groups={groups} selected={null} onChange={onChange} />);
    const car = screen.getByRole("checkbox", { name: "Car" });
    expect(car).toBeChecked();
    await userEvent.setup().click(car);
    expect(onChange).toHaveBeenCalledWith(["phone"]);
    // The address (the `selected` prop) has not moved: the box already shows the press.
    expect(car).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Phone" })).toBeDisabled();
  });

  it("goes with the address once it moves, also somewhere else than the press", async () => {
    const onChange = vi.fn();
    const view = render(<DeviceFilter groups={groups} selected={null} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Car" }));
    view.rerender(<DeviceFilter groups={groups} selected={["phone"]} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Car" })).not.toBeChecked();
    // A link or Back changes the address to another choice: it rules, not the earlier press.
    view.rerender(<DeviceFilter groups={groups} selected={["car"]} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Car" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Phone" })).not.toBeChecked();
  });

  it("does not bring a press back when the address returns to where it was made", async () => {
    const onChange = vi.fn();
    const view = render(<DeviceFilter groups={groups} selected={null} onChange={onChange} />);
    // A: every device. Press Car off (pending ["phone"], made on A) …
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Car" }));
    // … the address moves to B (only the car) …
    view.rerender(<DeviceFilter groups={groups} selected={["car"]} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Phone" })).not.toBeChecked();
    // … and Back to A: the boxes show A, not the press.
    view.rerender(<DeviceFilter groups={groups} selected={null} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Car" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Phone" })).toBeChecked();
  });
});
