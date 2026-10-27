import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ana, device, ids, outgoingShare, sharedDevice, user } from "./support/fixtures";
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
/** Opens a card's Details and gives back what it shows. */
async function openDetails(person: ReturnType<typeof userEvent.setup>, card: HTMLElement) {
  const button = within(card).getByRole("button", { name: "Details" });
  await person.click(button);
  const content = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (content === null) throw new Error("Details controls nothing");
  return content;
}

describe("the People page's list", () => {
  it("starts with Me as a person: what they do now and how fresh, none of their devices", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    const me = meCard();
    expect(within(me).getByText("On the map")).toBeInTheDocument();
    // The phone reported last, 90 seconds ago, standing still.
    expect(await within(me).findByText("Standing still")).toBeInTheDocument();
    expect(within(me).getByText("Live")).toBeInTheDocument();
    // Live: the time itself is on hover and in Details.
    expect(within(me).getByText("Live")).toHaveAttribute("datetime");
    expect(within(me).queryByText("1 min ago")).toBeNull();
    expect(within(me).queryByText(/devices? ·|last upload/)).toBeNull();
    expect(screen.queryByRole("article", { name: "iPhone 16" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
    // Me first, then the people who share.
    expect(
      me.compareDocumentPosition(sharingWithYou()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts the quick toggle on Me, for the device that reported last", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    const chips = await within(meCard()).findByRole("group", { name: "Now:" });
    expect(chips).toHaveAccessibleDescription(
      "Until you stop for 10 minutes or more or travel another way, for iPhone 16: the device that reported last. Your other devices are not changed.",
    );
    expect(await within(chips).findByRole("button", { name: "Auto", pressed: true })).toBeEnabled();
  });

  it("keeps each device's facts in Me's Details, closed at first, with the way to Devices", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    await within(meCard()).findByText("Standing still");
    const button = within(meCard()).getByRole("button", { name: "Details" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleDescription("Me");
    expect(within(meCard()).queryByRole("link", { name: "iPhone 16" })).toBeNull();

    const details = await openDetails(person, meCard());
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(within(details).getByRole("heading", { name: "Your devices" })).toBeInTheDocument();
    const devices = within(details).getAllByRole("listitem");
    expect(devices).toHaveLength(2);
    const [phone, car] = devices as [HTMLElement, HTMLElement];
    expect(within(phone).getByRole("link", { name: "iPhone 16" })).toHaveAttribute(
      "href",
      `/devices/${ids.phone}`,
    );
    expect(within(phone).getByText("62%")).toBeInTheDocument();
    expect(within(phone).getByText("50.9845° N, 3.5268° E ±12 m")).toBeInTheDocument();
    expect(within(phone).getByText("Standing still")).toBeInTheDocument();
    expect(within(phone).getByText("None in progress")).toBeInTheDocument();
    expect(within(car).getByText("Last reported movement")).toBeInTheDocument();
    expect(
      within(details).getByRole("link", { name: /Uploads, activity and settings of your devices/ }),
    ).toHaveAttribute("href", "/devices");

    await person.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(within(meCard()).queryByRole("link", { name: "iPhone 16" })).toBeNull();
  });

  it("points to a device's setup while none has uploaded yet", async () => {
    const waiting = device({ lastSeenAt: null, lastLocation: null, battery: null });
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": { status: 200, body: { devices: [waiting] } },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const me = meCard();
    expect(await within(me).findByText("Waiting for the first upload")).toBeInTheDocument();
    expect(within(me).getByRole("link", { name: "Setup details" })).toHaveAttribute(
      "href",
      `/devices/${ids.phone}`,
    );
    // Nothing to toggle before a first upload.
    expect(within(me).queryByRole("group", { name: "Now:" })).toBeNull();
    const details = await openDetails(person, me);
    expect(
      within(details).getByText("Updated", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("Waiting for the first upload");
  });

  it("keeps Me in the list while someone else is on the map, a tap away", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?people=${ids.ana}`, user });
    const me = meCard();
    expect(await within(me).findByText("Standing still")).toBeInTheDocument();
    expect(within(me).queryByText("On the map")).toBeNull();
    await person.click(within(me).getByRole("button", { name: "Show on map" }));
    expect(router.state.location.search).toBe("");
    expect(await within(me).findByText("On the map")).toBeInTheDocument();
  });

  it("shows each person like Find My, in two lines: who and how far, doing what, how fresh", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    const card = await screen.findByRole("article", { name: "Ana Bell" });
    expect(within(card).getByRole("heading", { level: 3, name: "Ana Bell" })).toBeInTheDocument();
    expect(within(card).getByText("Cycling · 16 km/h")).toBeInTheDocument();
    expect(within(card).getByText("Live")).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Battery 58%" })).toBeInTheDocument();
    expect(within(card).getByText("1.8 km")).toBeInTheDocument();
    // Every card has a Show on map and Details: their description says whose.
    expect(within(card).getByRole("button", { name: "Show on map" })).toHaveAccessibleDescription(
      "Ana Bell",
    );
    expect(within(card).getByRole("button", { name: "Details" })).toHaveAccessibleDescription(
      "Ana Bell",
    );
    // Everything else is in Details, closed at first.
    expect(within(card).queryByRole("link", { name: /Apple Maps/ })).toBeNull();
    expect(within(card).queryByText("Ana’s iPhone")).toBeNull();

    // bob shares roughly, without battery or activity: no battery glyph, the precision instead,
    // and a distance to the centre of his cell that says it is about that.
    const bob = screen.getByRole("article", { name: "bob" });
    expect(within(bob).getByText("Within about 500 m")).toBeInTheDocument();
    expect(within(bob).getByText("40 min ago")).toBeInTheDocument();
    expect(within(bob).queryByText("Live")).toBeNull();
    expect(within(bob).queryByRole("img", { name: /^Battery/ })).toBeNull();
    expect(within(bob).getByText("48.2 km", { exact: false }).closest("span")).toHaveTextContent(
      "Distance from you: ≈ about 48.2 km",
    );
  });

  it("keeps each shared device, the share's terms and the other actions in Details", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const card = await screen.findByRole("article", { name: "Ana Bell" });
    const details = await openDetails(person, card);
    const fact = (scope: HTMLElement, label: string) =>
      within(scope).getByText(label, { selector: "dt" }).nextElementSibling;
    expect(within(details).getByText("Ana’s iPhone")).toBeInTheDocument();
    expect(fact(details, "Updated")).toHaveTextContent("2 min ago");
    expect(fact(details, "Doing")).toHaveTextContent("Cycling · 16 km/h");
    expect(fact(details, "Battery")).toHaveTextContent("58%");
    expect(fact(details, "Accuracy")).toHaveTextContent("±8 m");
    expect(fact(details, "Trip")).toHaveTextContent("None in progress");
    expect(fact(details, "Distance")).toHaveTextContent("1.8 km");
    expect(fact(details, "Precision")).toHaveTextContent("Precise location");
    expect(fact(details, "Where they’ve been")).toHaveTextContent("Live only");
    expect(fact(details, "Battery and activity")).toHaveTextContent("Shared");
    expect(fact(details, "Until")).toHaveTextContent("No end set");
    expect(within(details).getByRole("link", { name: /Apple Maps/ })).toHaveAttribute(
      "href",
      "https://maps.apple.com/?ll=51.0543%2C3.7174&q=Ana+Bell",
    );
    expect(within(details).getByRole("link", { name: /Google Maps/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=51.0543%2C3.7174",
    );
    // The signed-in person already shares with Ana.
    expect(within(details).getByText(/You share with Ana Bell/)).toBeInTheDocument();
    expect(within(details).queryByRole("button", { name: /^Share back/ })).toBeNull();
    expect(within(details).getByRole("button", { name: "Hide Ana Bell" })).toBeInTheDocument();
  });

  it("tells a share without recent details from one that leaves them out", async () => {
    const quiet = ana({
      devices: [{ ...sharedDevice(), battery: null, activity: null }],
    });
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [quiet] } },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const details = await openDetails(
      person,
      await screen.findByRole("article", { name: "Ana Bell" }),
    );
    const fact = (label: string) =>
      within(details).getByText(label, { selector: "dt" }).nextElementSibling;
    // Ana shares battery and activity; there is just nothing recent of them.
    expect(fact("Battery")).toHaveTextContent("—");
    expect(fact("Trip")).toHaveTextContent("—");
    expect(fact("Battery and activity")).toHaveTextContent("Shared");
  });

  it("says in Details what a share leaves out", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const fact = (scope: HTMLElement, label: string) =>
      within(scope).getByText(label, { selector: "dt" }).nextElementSibling;
    const bob = await screen.findByRole("article", { name: "bob" });
    const hers = await openDetails(person, bob);
    expect(fact(hers, "Battery")).toHaveTextContent("Not shared");
    expect(fact(hers, "Trip")).toHaveTextContent("Not shared");
    expect(fact(hers, "Precision")).toHaveTextContent("Approximate location, within about 500 m");
    expect(fact(hers, "Until")).toHaveTextContent(/^Until /);
    expect(within(hers).getByRole("button", { name: "Share back with bob" })).toBeInTheDocument();
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
    const details = await openDetails(person, bob);
    await person.click(within(details).getByRole("button", { name: "Share back with bob" }));
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
    const details = await openDetails(person, card);
    await person.click(
      within(details).getByRole("button", { name: "Stop sharing your location with Ana Bell" }),
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
    const details = await openDetails(person, card);
    await person.click(within(details).getByRole("button", { name: "Hide Ana Bell" }));
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
    expect(await within(meCard()).findByText("Standing still")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Timeline" })).toBeInTheDocument();
  });

  it("names a device filter that leaves out all of one's devices", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": { status: 200, body: { devices: [device()] } },
    });
    renderPage(<PeoplePage />, { url: `/?people=me,${ids.ana}&devices=${ids.anaPhone}`, user });
    expect(
      await screen.findByText("The device filter in Map options leaves out all of your devices."),
    ).toBeInTheDocument();
    // Opened, since the address sets a filter.
    expect(screen.getByText("Advanced").closest("details")).toHaveAttribute("open");
  });
});
