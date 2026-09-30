import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AddDeviceDialog } from "../src/pages/devices/AddDeviceDialog";
import { device, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

/** The Devices page keeps `open` in the URL: it turns false only a moment after the close. */
function SlowToClose() {
  const [open, setOpen] = useState(true);
  const [closeRequests, setCloseRequests] = useState(0);
  return (
    <>
      <p>{`Close requests: ${closeRequests}`}</p>
      <button type="button" onClick={() => setOpen(false)}>
        URL updated
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open again
      </button>
      <AddDeviceDialog open={open} onClose={() => setCloseRequests((count) => count + 1)} />
    </>
  );
}

describe("AddDeviceDialog", () => {
  it("keeps the setup step on screen until it is closed, then starts over", async () => {
    const created = device({ name: "Lotte’s iPhone", lastSeenAt: null });
    mockApi({
      ...standardRoutes(),
      "POST /api/devices": {
        status: 201,
        body: {
          device: created,
          credentials: {
            endpoint: "https://trail.example.com/api/overland",
            accessToken: "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS",
            deviceKey: "lottes-iphone-x2k8",
            setupUrl: "overland://setup?url=x&token=y&device_id=z",
          },
        },
      },
    });
    const person = userEvent.setup();
    renderPage(<SlowToClose />, { path: "/devices", user });
    const form = screen.getByRole("dialog", { name: "Add a device" });
    await person.type(within(form).getByLabelText("Name"), "Lotte’s iPhone");
    await person.click(within(form).getByRole("button", { name: "Add device" }));
    const setup = await screen.findByRole("dialog", { name: "Set up Lotte’s iPhone" });

    await person.click(within(setup).getByRole("button", { name: "Done" }));
    expect(screen.getByText("Close requests: 1")).toBeInTheDocument();
    // Not back to the name form while the dialog is still open.
    expect(screen.getByRole("dialog", { name: "Set up Lotte’s iPhone" })).toBeInTheDocument();

    await person.click(screen.getByRole("button", { name: "URL updated" }));
    await person.click(screen.getByRole("button", { name: "Open again" }));
    expect(await screen.findByRole("dialog", { name: "Add a device" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});
