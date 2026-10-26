import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SharingSection } from "../src/pages/settings/SharingSection";
import { ids, shareLink, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

const url = `https://trail.example.com/s#trls_${"k".repeat(43)}`;

describe("Settings › Sharing", () => {
  it("lists public links with what they show and how often they were opened", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/share-links": {
        status: 200,
        body: {
          links: [
            shareLink(),
            shareLink({
              id: "019a2b4f-0c33-7a51-8d4e-6b7f1c2d3e50",
              label: "Old link",
              status: "expired",
              expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
              viewCount: 0,
              lastViewedAt: null,
            }),
          ],
        },
      },
    });
    renderPage(<SharingSection headingId="sharing" />, { user });
    const first = await screen.findByText("Jens on the way home");
    const row = first.closest("li");
    if (row === null) throw new Error("no row");
    expect(within(row).getByText("Works")).toBeInTheDocument();
    expect(within(row).getByText(/Approximate · Live only · All devices/)).toBeInTheDocument();
    expect(within(row).getByText(/Opened 12 times, last 10 min ago/)).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Turn off the link “Jens on the way home”" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/Not opened yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove the link “Old link”" })).toBeInTheDocument();
  });

  it("makes a link and shows its address once, with a code to scan", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "POST /api/v1/share-links": {
        status: 201,
        body: { link: shareLink(), secret: `trls_${"k".repeat(43)}`, url },
      },
    });
    const person = userEvent.setup();
    renderPage(<SharingSection headingId="sharing" />, { user });
    await screen.findByText("Jens on the way home");
    await person.type(screen.getByLabelText("Label (optional)"), "Bike to work");
    await person.click(screen.getByRole("radio", { name: /^Approximate/ }));
    expect(screen.getByRole("radio", { name: "Last 3 days" })).toBeDisabled();
    await person.selectOptions(screen.getByLabelText("Stops working after"), "1");
    await person.click(screen.getByRole("button", { name: "Make link" }));
    expect(await screen.findByRole("textbox", { name: "Public link" })).toHaveValue(url);
    expect(
      screen.getByRole("img", { name: "Code with the public link to your location" }),
    ).toBeInTheDocument();
    const body = api.calls.find((call) => call.method === "POST")?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      label: "Bike to work",
      deviceIds: null,
      precision: "approximate",
      historyDays: null,
      includeDetails: false,
    });
    const expires = Date.parse(String(body["expiresAt"]));
    expect(expires - Date.now()).toBeGreaterThan(3_500_000);
    expect(expires - Date.now()).toBeLessThanOrEqual(3_600_000);
  });

  it("turns a link off", async () => {
    const api = mockApi({
      ...standardRoutes(),
      [`DELETE /api/v1/share-links/${ids.link}`]: { status: 204 },
    });
    const person = userEvent.setup();
    renderPage(<SharingSection headingId="sharing" />, { user });
    await person.click(
      await screen.findByRole("button", { name: "Turn off the link “Jens on the way home”" }),
    );
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });

  it("lists the people you share with, to change or stop", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<SharingSection headingId="sharing" />, { user });
    await person.click(await screen.findByRole("button", { name: "Stop sharing with Ana Bell" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop sharing with Ana Bell?" });
    expect(within(dialog).getByText(/no longer sees where you are/)).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await person.click(screen.getByRole("button", { name: "Change sharing with Ana Bell" }));
    const change = await screen.findByRole("dialog", { name: "Sharing with Ana Bell" });
    expect(within(change).getByRole("radio", { name: /No change/ })).toBeChecked();
    expect(within(change).queryByLabelText("Email address")).toBeNull();
  });
});
