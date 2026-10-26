import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ana, ids, outgoingShare, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

describe("PeoplePage", () => {
  it("shows each person like Find My: where, how fresh, doing what, battery and distance", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    const card = await screen.findByRole("article", { name: "Ana Bell" });
    expect(within(card).getAllByText("2 min ago")).toHaveLength(2);
    expect(within(card).getByText("Live")).toBeInTheDocument();
    expect(within(card).getByText("16 km/h · cycling")).toBeInTheDocument();
    expect(within(card).getByText("58%")).toBeInTheDocument();
    expect(within(card).getAllByText("1.8 km").length).toBeGreaterThan(0);
    expect(within(card).getByRole("link", { name: /Apple Maps/ })).toHaveAttribute(
      "href",
      "https://maps.apple.com/?ll=51.0543%2C3.7174&q=Ana+Bell",
    );
    expect(within(card).getByRole("link", { name: /Google Maps/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=51.0543%2C3.7174",
    );
    // The signed-in person already shares with Ana.
    expect(within(card).getByText(/You share with Ana Bell/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Share back" })).toBeNull();

    const bob = screen.getByRole("article", { name: "bob" });
    expect(within(bob).getByText("Approximate location, within about 500 m")).toBeInTheDocument();
    expect(within(bob).getByText("Not shared")).toBeInTheDocument();
    expect(within(bob).getByRole("button", { name: "Share back" })).toBeInTheDocument();
    expect(within(bob).getByText(/Live only · Until/)).toBeInTheDocument();

    const map = screen.getByRole("img", { name: /Map of where Ana Bell and bob are/ });
    expect(map).toHaveAttribute("data-positions", "2");
  });

  it("lists whom you share with, with what they see", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    const region = await screen.findByRole("heading", { name: "You share with" });
    const section = region.closest("section");
    if (section === null) throw new Error("no section");
    expect(await within(section).findByText("Ana Bell")).toBeInTheDocument();
    expect(within(section).getByText("Sees you")).toBeInTheDocument();
    expect(
      within(section).getByText(/Precise · Live only · All devices · battery and activity/),
    ).toBeInTheDocument();
    expect(within(section).getByText(/Until stopped · last looked 5 min ago/)).toBeInTheDocument();
    expect(
      within(section).getByRole("button", { name: "Stop sharing with Ana Bell" }),
    ).toBeInTheDocument();
  });

  it("invites you to share when nobody shares with you", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [] } },
      "GET /api/v1/shares": { status: 200, body: { shares: [] } },
    });
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByText("Nobody shares with you yet")).toBeInTheDocument();
    expect(
      screen.getByText(/When someone shares their location with jens@example.com/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nobody sees your location. Share it with someone, for an hour, until the end of the day or for as long as you like.",
      ),
    ).toBeInTheDocument();
  });

  it("shares back from a card: address filled in, history only with a precise location", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "POST /api/v1/shares": ({ body }) => ({
        status: 201,
        body: {
          share: outgoingShare({
            id: "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a26",
            recipient: { email: "bob@example.com", userId: ids.bob, displayName: "bob" },
            precision: (body as { precision: "approximate" }).precision,
          }),
        },
      }),
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const bob = await screen.findByRole("article", { name: "bob" });
    await person.click(within(bob).getByRole("button", { name: "Share back" }));
    const dialog = await screen.findByRole("dialog", { name: "Share my location" });
    expect(within(dialog).getByLabelText("Email address")).toHaveValue("bob@example.com");
    const sevenDays = within(dialog).getByRole("radio", { name: "Last 7 days" });
    expect(sevenDays).toBeEnabled();
    await person.click(within(dialog).getByRole("radio", { name: /Approximate/ }));
    expect(sevenDays).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Live only" })).toBeChecked();
    await person.click(within(dialog).getByRole("radio", { name: "For one hour" }));
    await person.click(within(dialog).getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
        email: "bob@example.com",
        deviceIds: null,
        precision: "approximate",
        historyDays: null,
        includeDetails: true,
        duration: "hour",
      }),
    );
    expect(await screen.findByText("bob can see your location now")).toBeInTheDocument();
  });

  it("says when the address has no account yet, and lets admins invite it", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "POST /api/v1/shares": {
        status: 201,
        body: {
          share: outgoingShare({
            status: "pending",
            recipient: { email: "new@example.com", userId: null, displayName: null },
          }),
        },
      },
      "POST /api/admin/invites": {
        status: 201,
        body: {
          invite: {
            id: "01926f3d-3f60-7b82-9354-6e7f8091a2b4",
            email: "new@example.com",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            usedAt: null,
            usedByEmail: null,
          },
          url: "https://trail.example.com/invite/abc",
        },
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    await screen.findByRole("article", { name: "Ana Bell" });
    await person.click(
      screen.getAllByRole("button", { name: "Share my location" })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", { name: "Share my location" });
    await person.type(within(dialog).getByLabelText("Email address"), "new@example.com");
    await person.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(
      await screen.findByText("They will see you once they sign up and you confirm"),
    ).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Invite new@example.com" }));
    expect(await screen.findByRole("textbox", { name: "Invite link" })).toHaveValue(
      "https://trail.example.com/invite/abc",
    );
    expect(api.calls.find((call) => call.path === "/api/admin/invites")?.body).toEqual({
      email: "new@example.com",
    });
  });

  it("checks the address before sharing", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    await screen.findByRole("article", { name: "Ana Bell" });
    await person.click(
      screen.getAllByRole("button", { name: "Share my location" })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", { name: "Share my location" });
    await person.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(within(dialog).getByText("Enter the person’s email address.")).toBeInTheDocument();
    await person.type(within(dialog).getByLabelText("Email address"), user.email);
    await person.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(within(dialog).getByText("That is your own address.")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("hides a person and offers to show them again", async () => {
    let hidden = false;
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": () => ({ status: 200, body: { people: hidden ? [] : [ana()] } }),
      "GET /api/v1/shares/incoming": () => ({
        status: 200,
        body: {
          shares: [
            {
              id: ids.anaShare,
              owner: { userId: ids.ana, displayName: "Ana Bell", email: "ana@example.com" },
              precision: "precise",
              historyDays: null,
              includeDetails: true,
              expiresAt: null,
              createdAt: "2026-10-20T08:00:00.000Z",
              hiddenAt: hidden ? new Date().toISOString() : null,
            },
          ],
        },
      }),
      [`POST /api/v1/shares/incoming/${ids.anaShare}/hide`]: () => {
        hidden = true;
        return {
          status: 200,
          body: {
            share: {
              id: ids.anaShare,
              owner: { userId: ids.ana, displayName: "Ana Bell", email: "ana@example.com" },
              precision: "precise",
              historyDays: null,
              includeDetails: true,
              expiresAt: null,
              createdAt: "2026-10-20T08:00:00.000Z",
              hiddenAt: new Date().toISOString(),
            },
          },
        };
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const card = await screen.findByRole("article", { name: "Ana Bell" });
    await person.click(within(card).getByRole("button", { name: "Hide Ana Bell" }));
    expect(await screen.findByText("Hidden (1)")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Ana Bell" })).toBeNull();
    expect(api.calls.some((call) => call.path.endsWith("/hide"))).toBe(true);
    expect(screen.getByRole("button", { name: "Show Ana Bell again" })).toBeInTheDocument();
  });

  it("reports people that could not be loaded", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": {
        status: 503,
        body: { error: { code: "unavailable", message: "Database down" } },
      },
    });
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByText("People could not be loaded")).toBeInTheDocument();
  });
});
