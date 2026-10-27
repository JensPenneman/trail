import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ana, device, ids, outgoingShare, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const meCard = () => screen.getByRole("region", { name: "Me" });
const sharingWithYou = () => screen.getByRole("region", { name: "Sharing with you" });

describe("the People page's list", () => {
  it("starts with Me: their device cards and uploads while Me is on the map", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    const me = meCard();
    expect(within(me).getByText("On the map")).toBeInTheDocument();
    expect(await within(me).findByRole("article", { name: "iPhone 16" })).toBeInTheDocument();
    expect(within(me).getByRole("article", { name: "Car" })).toBeInTheDocument();
    expect(within(me).getByRole("region", { name: "Uploads" })).toBeInTheDocument();
    // Me first, then the people who share.
    expect(
      me.compareDocumentPosition(sharingWithYou()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sums one's devices up in a line where the view shows no cards of them", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=history", user });
    const me = meCard();
    expect(await within(me).findByText(/^2 devices · 1 live · last upload/)).toBeInTheDocument();
    expect(within(me).getByText("On the map")).toBeInTheDocument();
    expect(within(me).queryByRole("article")).toBeNull();
  });

  it("keeps Me in the list while someone else is on the map, a tap away", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?people=${ids.ana}`, user });
    const me = meCard();
    expect(await within(me).findByText(/^2 devices · 1 live/)).toBeInTheDocument();
    expect(within(me).queryByText("On the map")).toBeNull();
    expect(within(me).queryByRole("article")).toBeNull();
    await person.click(within(me).getByRole("button", { name: "Show on map" }));
    expect(router.state.location.search).toBe("");
    expect(await within(me).findByRole("article", { name: "iPhone 16" })).toBeInTheDocument();
  });

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
    // Every card has a Show on map: its description says whose.
    expect(within(card).getByRole("button", { name: "Show on map" })).toHaveAccessibleDescription(
      "Ana Bell",
    );
    // The signed-in person already shares with Ana.
    expect(within(card).getByText(/You share with Ana Bell/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Share back" })).toBeNull();

    const bob = screen.getByRole("article", { name: "bob" });
    expect(within(bob).getByText("Approximate location, within about 500 m")).toBeInTheDocument();
    expect(within(bob).getByText("Not shared")).toBeInTheDocument();
    expect(within(bob).getByRole("button", { name: "Share back" })).toHaveAccessibleDescription(
      "bob",
    );
    expect(within(bob).getByText(/Live only · Until/)).toBeInTheDocument();
  });

  it("says with how many people one shares, and leads to Settings › Sharing", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/shares": {
        status: 200,
        body: {
          shares: [
            outgoingShare(),
            outgoingShare({
              id: "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a27",
              status: "joined",
              recipient: { email: "new@example.com", userId: ids.bob, displayName: "Nora" },
            }),
          ],
        },
      },
    });
    renderPage(<PeoplePage />, { user });
    const line = await screen.findByRole("link", { name: /^You share with 2 people/ });
    expect(line).toHaveAttribute("href", "/settings/sharing");
    expect(line).toHaveAccessibleName(
      "You share with 2 people, 1 waits for you to confirm: Settings › Sharing",
    );
    // The list itself lives in Settings now.
    expect(screen.queryByRole("button", { name: /^Change sharing with/ })).toBeNull();
  });

  it("invites to share when nobody shares with you", async () => {
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
    expect(await screen.findByRole("link", { name: /^You share with nobody/ })).toHaveAttribute(
      "href",
      "/settings/sharing",
    );
    expect(screen.getByRole("button", { name: "Share my location" })).toBeInTheDocument();
    // Nobody to add: no Everyone, and the selector offers only Me.
    expect(screen.queryByRole("button", { name: "Show everyone" })).toBeNull();
    expect(screen.queryByRole("group", { name: "People" })).toBeNull();
  });

  it("tells when someone starts sharing while the page is open", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { liveStore } = renderPage(<PeoplePage />, { user });
    await screen.findByRole("article", { name: "Ana Bell" });
    act(() => liveStore.addShareNotice({ shareId: ids.anaShare, at: Date.now() }));
    const notice = within(sharingWithYou()).getByText("Ana Bell shares their location with you");
    expect(notice).toBeInTheDocument();
    await person.click(within(sharingWithYou()).getByRole("button", { name: "OK" }));
    expect(screen.queryByText("Ana Bell shares their location with you")).toBeNull();
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

  it("stops sharing back from a card, after asking", async () => {
    const api = mockApi({
      ...standardRoutes(),
      [`DELETE /api/v1/shares/${ids.myShare}`]: { status: 204 },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const card = await screen.findByRole("article", { name: "Ana Bell" });
    await person.click(
      within(card).getByRole("button", { name: "Stop sharing your location with Ana Bell" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Stop sharing with Ana Bell?" });
    await person.click(within(dialog).getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(api.calls.find((call) => call.method === "DELETE")?.path).toBe(
      `/api/v1/shares/${ids.myShare}`,
    );
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
    await person.click(screen.getByRole("button", { name: "Share my location" }));
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
    await person.click(screen.getByRole("button", { name: "Share my location" }));
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
    const incomingShare = () => ({
      id: ids.anaShare,
      owner: { userId: ids.ana, displayName: "Ana Bell", email: "ana@example.com" },
      precision: "precise",
      historyDays: null,
      includeDetails: true,
      expiresAt: null,
      createdAt: "2026-10-20T08:00:00.000Z",
      hiddenAt: hidden ? new Date().toISOString() : null,
    });
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": () => ({ status: 200, body: { people: hidden ? [] : [ana()] } }),
      "GET /api/v1/shares/incoming": () => ({
        status: 200,
        body: { shares: [incomingShare()] },
      }),
      [`POST /api/v1/shares/incoming/${ids.anaShare}/hide`]: () => {
        hidden = true;
        return { status: 200, body: { share: incomingShare() } };
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

  it("reports people that could not be loaded, and still shows one's own", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": {
        status: 503,
        body: { error: { code: "unavailable", message: "Database down" } },
      },
    });
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByText("People could not be loaded")).toBeInTheDocument();
    expect(await within(meCard()).findByRole("article", { name: "iPhone 16" })).toBeInTheDocument();
  });

  it("names a device filter that leaves out all of one's devices", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": { status: 200, body: { devices: [device()] } },
    });
    renderPage(<PeoplePage />, { url: `/?people=me,${ids.ana}&devices=${ids.anaPhone}`, user });
    expect(
      await within(meCard()).findByText(
        "The device filter in Map options leaves out all of your devices.",
      ),
    ).toBeInTheDocument();
  });
});
