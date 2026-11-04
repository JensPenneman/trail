import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeviceSummary } from "@trail/contracts/device";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { FreshnessIndicator } from "../src/app/FreshnessIndicator";
import type { CacheStore } from "../src/cache/openCacheStore";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { localDateOf } from "../src/time/localDateOf";
import { localDayRange } from "../src/time/localDayRange";
import { holdAll, seedEntry, warmClient } from "./support/cacheHarness";
import {
  ana,
  automatic,
  car,
  config,
  dayStamp,
  device,
  ids,
  levelTracks,
  outgoingShare,
  sharedDevice,
  timeline,
  tracks,
  user,
} from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { createTestQueryClient, renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

/** Me's own list, and the group of those who share with you. */
const meList = () => screen.getByRole("list", { name: "Me" });
const sharingList = () => screen.getByRole("list", { name: "Sharing with you" });
const meRow = () => within(meList()).getByRole("link", { name: /^Me/ });
/** A person's detail: the link in the list opens it, in place of the list. */
async function openPerson(person: ReturnType<typeof userEvent.setup>, name: string) {
  await person.click(await screen.findByRole("link", { name: new RegExp(`^${name}`) }));
  return screen.findByRole("region", { name });
}
const fact = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label, { selector: "dt" }).nextElementSibling;

describe("the People page's list", () => {
  it("starts with Me as a row: what they do now and how fresh, none of their devices", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    const me = meRow();
    // The phone reported last, 90 seconds ago, standing still.
    expect(await within(me).findByText("Standing still")).toBeInTheDocument();
    expect(within(me).getByText("Live")).toBeInTheDocument();
    // Live: the time itself is on hover and in the detail.
    expect(within(me).getByText("Live")).toHaveAttribute("datetime");
    expect(within(me).queryByText("1 min ago")).toBeNull();
    expect(within(me).queryByText(/devices? ·|last upload/)).toBeNull();
    expect(me).toHaveAttribute("href", "/?person=me");
    expect(screen.queryByRole("link", { name: "iPhone 16" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
    // The root has no detail, no timeline, no summary and no Show on map.
    expect(screen.queryByRole("region", { name: "Me" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Your day so far" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
    // Me first, in a group of its own; then the people who share, live ones first.
    expect(
      within(meList())
        .getAllByRole("link")
        .map((row) => row.getAttribute("href")),
    ).toEqual(["/?person=me"]);
    expect(
      within(sharingList())
        .getAllByRole("link")
        .map((row) => row.getAttribute("href")),
    ).toEqual([`/?person=${ids.ana}`, `/?person=${ids.bob}`]);
    // Nothing but the people: no summary, no footer; what the view says of itself is not shown.
    expect(screen.queryByRole("link", { name: /^You share with/ })).toBeNull();
    expect(screen.getByText(/^Where everyone is now/).closest(".visually-hidden")).not.toBeNull();
  });

  it("opens Me's detail in place of the list: the devices, always, and the way back", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    await within(meRow()).findByText("Standing still");
    const me = await openPerson(person, "Me");
    expect(router.state.location.search).toBe("?person=me");
    expect(screen.queryByRole("list", { name: "Me" })).toBeNull();
    // The name takes the focus, so a screen reader starts at the detail.
    const heading = within(me).getByRole("heading", { level: 2, name: "Me" });
    expect(heading).toHaveFocus();
    expect(within(me).getAllByText("Standing still").length).toBeGreaterThan(0);
    expect(within(me).getByRole("heading", { name: "Your devices" })).toBeInTheDocument();
    const devices = within(me).getByRole("region", { name: "Your devices" });
    const [phone, car] = within(devices).getAllByRole("listitem") as [HTMLElement, HTMLElement];
    expect(within(phone).getByRole("link", { name: "iPhone 16" })).toHaveAttribute(
      "href",
      `/settings/devices/${ids.phone}`,
    );
    expect(within(phone).getByText("62%")).toBeInTheDocument();
    expect(within(phone).getByText("50.9845° N, 3.5268° E ±12 m")).toBeInTheDocument();
    expect(within(phone).getByText("None in progress")).toBeInTheDocument();
    expect(within(car).getByText("Last reported movement")).toBeInTheDocument();
    expect(
      within(me).getByRole("link", { name: /Uploads, activity and settings of your devices/ }),
    ).toHaveAttribute("href", "/settings/devices");
    // No toggle of the transport mode: that is the API's and MCP clients'.
    expect(within(me).queryByRole("group", { name: "Now:" })).toBeNull();

    // Back to the list; the focus returns to the row that was opened.
    await person.click(within(me).getByRole("link", { name: "Back to People" }));
    expect(router.state.location.search).toBe("");
    expect(await screen.findByRole("link", { name: /^Me/ })).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Me" })).toBeNull();
  });

  it("leaves the focus alone on a link that opens a detail", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?person=me", user });
    const me = await screen.findByRole("region", { name: "Me" });
    expect(within(me).getByRole("heading", { level: 2, name: "Me" })).not.toHaveFocus();
  });

  it("points to a device's setup while none has uploaded yet", async () => {
    const waiting = device({ lastSeenAt: null, lastLocation: null, battery: null });
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": { status: 200, body: { devices: [waiting] } },
    });
    renderPage(<PeoplePage />, { url: "/?person=me", user });
    const me = await screen.findByRole("region", { name: "Me" });
    expect((await within(me).findAllByText("Waiting for the first upload")).length).toBe(2);
    expect(within(me).getByRole("link", { name: "Setup details" })).toHaveAttribute(
      "href",
      `/settings/devices/${ids.phone}/setup`,
    );
    expect(
      within(me).getByText("Updated", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("Waiting for the first upload");
  });

  it("shows each person like Find My, in two lines: who and how far, doing what, how fresh", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    const ana = await screen.findByRole("link", { name: /^Ana Bell/ });
    expect(within(ana).getByText("Cycling · 16 km/h")).toBeInTheDocument();
    expect(within(ana).getByText("Live")).toBeInTheDocument();
    expect(within(ana).getByRole("img", { name: "Battery 58%" })).toBeInTheDocument();
    expect(within(ana).getByText("1.8 km")).toBeInTheDocument();
    // A row is one link, named by what it says in order; it has no heading of its own.
    expect(ana).toHaveAccessibleName(
      /^Ana Bell\s+Battery 58%.*1\.8 km\s+Live,\s*Cycling\s+·\s+16\s+km\/h$/,
    );
    expect(within(ana).queryByRole("heading")).toBeNull();
    // Everything else is in the detail.
    expect(screen.queryByRole("link", { name: /Apple Maps/ })).toBeNull();
    expect(screen.queryByText("Ana’s iPhone")).toBeNull();

    // bob shares roughly, without battery or activity: no battery glyph, the precision instead,
    // and a distance to the centre of his cell that says it is about that.
    const bob = screen.getByRole("link", { name: /^bob/ });
    expect(within(bob).getByText("Within about 500 m")).toBeInTheDocument();
    expect(within(bob).getByText("40 min ago")).toBeInTheDocument();
    expect(within(bob).queryByText("Live")).toBeNull();
    expect(within(bob).queryByRole("img", { name: /^Battery/ })).toBeNull();
    expect(within(bob).getByText("48.2 km", { exact: false }).closest("span")).toHaveTextContent(
      "Distance from you: ≈ about 48.2 km",
    );
  });

  it("keeps each shared device, the share's terms and the other actions in the detail", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const details = await openPerson(person, "Ana Bell");
    expect(within(details).getByRole("heading", { level: 2, name: "Ana Bell" })).toHaveFocus();
    expect(within(details).getAllByText("Cycling · 16 km/h").length).toBeGreaterThan(0);
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
    // Their devices are not rows of the list: Me's are in Me's detail.
    expect(within(details).queryByRole("heading", { name: "Your devices" })).toBeNull();
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
    const details = await openPerson(person, "Ana Bell");
    // Ana shares battery and activity; there is just nothing recent of them.
    expect(fact(details, "Battery")).toHaveTextContent("—");
    expect(fact(details, "Trip")).toHaveTextContent("—");
    expect(fact(details, "Battery and activity")).toHaveTextContent("Shared");
  });

  it("says in the detail what a share leaves out", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const hers = await openPerson(person, "bob");
    expect(fact(hers, "Battery")).toHaveTextContent("Not shared");
    expect(fact(hers, "Trip")).toHaveTextContent("Not shared");
    expect(fact(hers, "Precision")).toHaveTextContent("Approximate location, within about 500 m");
    expect(fact(hers, "Until")).toHaveTextContent(/^Until /);
    expect(within(hers).getByRole("button", { name: "Share back with bob" })).toBeInTheDocument();
  });

  it("has no line about one's own sharing under the list: that is Me's page", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/shares": { status: 200, body: { shares: [outgoingShare()] } },
    });
    renderPage(<PeoplePage />, { user });
    await screen.findByRole("link", { name: /^Ana Bell/ });
    expect(screen.queryByRole("link", { name: /^You share with/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Share my location" })).toHaveLength(1);
  });

  it("holds Share my location in the heading's row as an icon, once someone shares", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    const button = await screen.findByRole("button", { name: "Share my location" });
    expect(button).toHaveClass("button--icon-only");
    expect(button).toHaveTextContent("Share my location");
    expect(button.closest("header")).toContainElement(
      screen.getByRole("heading", { level: 1, name: "People" }),
    );
  });

  it("shows just the Me row when nobody shares, and Share my location stays in the heading", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [] } },
      "GET /api/v1/shares": { status: 200, body: { shares: [] } },
    });
    renderPage(<PeoplePage />, { user });
    await within(meRow()).findByText("Standing still");
    // No card, no group, no line about one's own side.
    expect(screen.queryByText("Nobody shares with you yet")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sharing with you" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^You share with/ })).toBeNull();
    // The one button is the icon next to the heading, as with people.
    const buttons = screen.getAllByRole("button", { name: "Share my location" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveClass("button--icon-only");
    expect(within(meList()).getAllByRole("link")).toHaveLength(1);
  });

  it("puts the way to a first phone under the Me row", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": { status: 200, body: { devices: [] } },
    });
    renderPage(<PeoplePage />, { user });
    const add = await screen.findByRole("link", { name: "Add a device" });
    const me = meRow();
    expect(me.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(meList()).toContainElement(add);
    expect(within(me).getByText("No devices yet")).toBeInTheDocument();
  });

  it("tells when someone starts sharing while the page is open", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { liveStore } = renderPage(<PeoplePage />, { user });
    await screen.findByRole("link", { name: /^Ana Bell/ });
    act(() => liveStore.addShareNotice({ shareId: ids.anaShare, at: Date.now() }));
    expect(screen.getByText("Ana Bell shares their location with you")).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Ana Bell shares their location with you")).toBeNull();
  });

  it("shares back from the detail: address filled in, history only with a precise location", async () => {
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
    const details = await openPerson(person, "bob");
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

  it("stops sharing back from the detail, after asking", async () => {
    const api = mockApi({
      ...standardRoutes(),
      [`DELETE /api/v1/shares/${ids.myShare}`]: { status: 204 },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const details = await openPerson(person, "Ana Bell");
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
    await screen.findByRole("link", { name: /^Ana Bell/ });
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
    await screen.findByRole("link", { name: /^Ana Bell/ });
    await person.click(screen.getByRole("button", { name: "Share my location" }));
    const dialog = await screen.findByRole("dialog", { name: "Share my location" });
    await person.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(within(dialog).getByText("Enter the person’s email address.")).toBeInTheDocument();
    await person.type(within(dialog).getByLabelText("Email address"), user.email);
    await person.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(within(dialog).getByText("That is your own address.")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("hides a person from the detail, returns to the list, says so and offers to show them again", async () => {
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
      // The people answer first and the incoming shares late, as they do: the mutation's own
      // callback (leaving the detail) runs only after all of them.
      "GET /api/v1/shares/incoming": async () => {
        if (hidden) await new Promise((resolve) => setTimeout(resolve, 150));
        return { status: 200, body: { shares: [incomingShare()] } };
      },
      [`POST /api/v1/shares/incoming/${ids.anaShare}/hide`]: () => {
        hidden = true;
        return { status: 200, body: { share: incomingShare() } };
      },
    });
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    const details = await openPerson(person, "Ana Bell");
    await person.click(within(details).getByRole("button", { name: "Hide Ana Bell" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    const hiddenRow = await screen.findByRole("link", { name: "Hidden (1)" });
    expect(hiddenRow).toHaveAttribute("href", "/?list=hidden");
    // Replaced, not pushed: Back does not return to a detail that is gone.
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.queryByRole("region", { name: "Ana Bell" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Ana Bell/ })).toBeNull();
    expect(
      await screen.findByText("Ana Bell is hidden. Show them again under Hidden."),
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.endsWith("/hide"))).toBe(true);
    // Her row is gone: the focus falls back to the page's heading.
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toHaveFocus();
    // She is shown again from the Hidden list.
    await person.click(hiddenRow);
    expect(await screen.findByRole("heading", { level: 2, name: "Hidden" })).toHaveFocus();
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
    expect(await within(meRow()).findByText("Standing still")).toBeInTheDocument();
    // Me's detail is there to open, with the day so far.
    const person = userEvent.setup();
    await openPerson(person, "Me");
    expect(await screen.findByRole("region", { name: "Timeline" })).toBeInTheDocument();
  });

  it("opens the device filter when the address sets one", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: `/?person=me&devices=${ids.phone}`, user });
    expect((await screen.findByText("Advanced")).closest("details")).toHaveAttribute("open");
  });
});

describe("the People page on a warm open", () => {
  const today = localDateOf(Date.now(), user.timezone);
  const range = { ...localDayRange(today, today, user.timezone), deviceIds: null };
  const tracksKey = queryKeys.tracks(range);
  const timelineKey = queryKeys.timeline(range);
  const levelKey = queryKeys.levelTracks({ ...range, level: "inferred" });
  const stamps = [dayStamp(ids.phone, today, "raw-today", "processed-today")];

  /** The last visit's answers, kept on disk with their ETags. */
  async function lastVisit(store: CacheStore, devices: DeviceSummary[], fetchedAt: number) {
    await seedEntry(store, { user, queryKey: queryKeys.config, answer: config, fetchedAt });
    await seedEntry(store, {
      user,
      queryKey: queryKeys.devices,
      answer: { devices },
      fetchedAt,
      etag: 'W/"devices"',
    });
    await seedEntry(store, {
      user,
      queryKey: tracksKey,
      answer: { ...tracks(range.from, range.to), stamps },
      fetchedAt,
      etag: 'W/"tracks"',
    });
    await seedEntry(store, {
      user,
      queryKey: levelKey,
      answer: { ...levelTracks(range.from, range.to, "inferred"), stamps },
      fetchedAt,
      etag: 'W/"levels"',
    });
    await seedEntry(store, {
      user,
      queryKey: timelineKey,
      answer: { items: timeline(range.from), pending: false, stamps },
      fetchedAt,
      etag: 'W/"timeline"',
    });
    await seedEntry(store, {
      user,
      queryKey: queryKeys.deviceMode(ids.phone),
      answer: { mode: automatic },
      fetchedAt,
    });
  }

  /** The server: the standard answers with the same ETags, every one held until released. */
  function slowServer(devices: DeviceSummary[]) {
    const held = holdAll({
      ...standardRoutes(),
      "GET /api/config": { status: 200, body: config },
      "GET /api/devices": { status: 200, body: { devices }, etag: 'W/"devices"' },
      "GET /api/tracks": { status: 200, body: tracks(range.from, range.to), etag: 'W/"tracks"' },
      "GET /api/v1/tracks": {
        status: 200,
        body: levelTracks(range.from, range.to, "inferred"),
        etag: 'W/"levels"',
      },
      "GET /api/v1/segments": {
        status: 200,
        body: { items: timeline(range.from), nextCursor: null, pending: false },
        etag: 'W/"timeline"',
      },
      [`GET /api/v1/devices/${ids.phone}/mode`]: { status: 200, body: { mode: automatic } },
    });
    return { release: held.release, api: mockApi(held.routes) };
  }

  it("shows the copy before any request resolved, says so, then revalidates with 304s", async () => {
    const devices = [device(), car()];
    const queryClient = createTestQueryClient();
    await warmClient(queryClient, user, (store) => lastVisit(store, devices, Date.now() - 180_000));
    const server = slowServer(devices);
    const { liveStore } = renderPage(
      <>
        <FreshnessIndicator />
        <PeoplePage />
      </>,
      { url: "/?person=me", user, queryClient },
    );
    // From the copy: what the phone does and today's stops and moves.
    expect(
      within(screen.getByRole("region", { name: "Me" })).getAllByText("Standing still")[0],
    ).toBeInTheDocument();
    const day = screen.getByRole("region", { name: "Your day so far" });
    expect(within(day).getAllByText(/Train/).length).toBeGreaterThan(0);
    expect(server.api.calls.every((call) => call.status === undefined)).toBe(true);
    expect(await screen.findByText("Updating…")).toBeInTheDocument();

    act(() => server.release());
    // Every revalidation sent its ETag and came back unchanged.
    await waitFor(() => expect(screen.queryByText("Updating…")).toBeNull());
    const conditional = server.api.calls.filter((call) => call.headers?.["if-none-match"]);
    expect(conditional.map((call) => call.path).sort()).toEqual(
      ["/api/devices", "/api/tracks", "/api/v1/segments", "/api/v1/tracks"].sort(),
    );
    expect(conditional.every((call) => call.status === 304)).toBe(true);
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
    act(() => liveStore.setConnection("open"));
    expect(screen.getByText("Live", { selector: ".freshness__text" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Me" })).getAllByText("Standing still")[0],
    ).toBeInTheDocument();
  });

  it("does not call a copy live that is older than the live window while the stream is down", async () => {
    const devices = [device(), car()];
    const queryClient = createTestQueryClient();
    await warmClient(queryClient, user, (store) =>
      lastVisit(store, devices, Date.now() - 20 * 60_000),
    );
    slowServer(devices);
    renderPage(<PeoplePage />, { user, queryClient });
    const me = meRow();
    // The phone's position is a minute and a half old, but the copy is twenty minutes old.
    expect(within(me).queryByText("Live")).toBeNull();
    expect(within(me).getByText(/^as of \d\d:\d\d$/)).toBeInTheDocument();
  });
});
