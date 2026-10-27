import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ids, outgoingShare, shareLink } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderSettings } from "./support/renderSettings";
import { standardRoutes } from "./support/standardRoutes";

const url = `https://trail.example.com/s#trls_${"k".repeat(43)}`;
const heading = (name: string) => screen.findByRole("heading", { level: 1, name });
/** The label/value pairs of a page's facts. */
const facts = () =>
  Object.fromEntries(
    screen
      .getAllByRole("term")
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  );

describe("Settings › Public links", () => {
  it("lists the links with what they show and how often they were opened, a page each", async () => {
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
    renderSettings("/settings/links");
    const links = await screen.findByRole("list", { name: "Links" });
    const works = within(links).getByRole("link", { name: "Jens on the way home" });
    expect(works).toHaveAttribute("href", `/settings/links/${ids.link}`);
    // "10 min ago", or 9 by the page's clock, which moves on in whole minutes.
    expect(works).toHaveAccessibleDescription(
      /^Approximate · Live only · All devices · Opened 12 times, last (9|10) min ago Works$/,
    );
    expect(within(links).getByRole("link", { name: "Old link" })).toHaveAccessibleDescription(
      /Not opened yet Ended$/,
    );
  });

  it("makes a link and shows its address on its page, once, with a code to scan", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "POST /api/v1/share-links": {
        status: 201,
        body: { link: shareLink(), secret: `trls_${"k".repeat(43)}`, url },
      },
    });
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/links");
    await person.click(await screen.findByRole("button", { name: "Make a public link" }));
    const dialog = screen.getByRole("dialog", { name: "Make a public link" });
    expect(within(dialog).getByLabelText("Label (optional)")).toHaveAttribute(
      "placeholder",
      "Shared location",
    );
    await person.type(within(dialog).getByLabelText("Label (optional)"), "Bike to work");
    await person.click(within(dialog).getByRole("radio", { name: /^Approximate/ }));
    expect(within(dialog).getByRole("radio", { name: "Last 3 days" })).toBeDisabled();
    await person.selectOptions(within(dialog).getByLabelText("Stops working after"), "1");
    await person.click(within(dialog).getByRole("button", { name: "Make link" }));

    expect(await heading("Jens on the way home")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/settings/links/${ids.link}`);
    expect(screen.getByRole("textbox", { name: "Public link" })).toHaveValue(url);
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

    // Gone once the page is left: the next visit cannot show it again.
    await person.click(screen.getByRole("link", { name: "Back to Public links" }));
    await person.click(await screen.findByRole("link", { name: "Jens on the way home" }));
    expect(await heading("Jens on the way home")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Public link" })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot show the address or its code again/)).toBeInTheDocument();
  });

  it("shows what a link shows and its views, and turns it off after a confirmation", async () => {
    let off = false;
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/v1/share-links": () => ({
        status: 200,
        body: { links: off ? [] : [shareLink()] },
      }),
      [`DELETE /api/v1/share-links/${ids.link}`]: () => {
        off = true;
        return { status: 204 };
      },
    });
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/links");
    await person.click(await screen.findByRole("link", { name: "Jens on the way home" }));
    expect(await heading("Jens on the way home")).toBeInTheDocument();
    expect(facts()).toMatchObject({
      Status: "Works",
      Precision: "Approximate location, within about 500 m",
      History: "Live only",
      Devices: "All devices",
      "Battery and activity": "Not shown",
      Views: expect.stringMatching(/^Opened 12 times, last (9|10) min ago$/),
    });
    await person.click(screen.getByRole("button", { name: "Turn off link" }));
    const confirm = screen.getByRole("dialog", { name: "Turn off “Jens on the way home”?" });
    await person.click(within(confirm).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
    // Back to the list, which no longer has it.
    expect(await heading("Public links")).toBeInTheDocument();
    expect(router.state.historyAction).toBe("POP");
    expect(await screen.findByText("No links yet.")).toBeInTheDocument();
  });
});

describe("Settings › Sharing", () => {
  it("lists the people you share with, a page each", async () => {
    mockApi(standardRoutes());
    renderSettings("/settings/sharing");
    const shares = await screen.findByRole("list", { name: "You share with" });
    const ana = within(shares).getByRole("link", { name: "Ana Bell" });
    expect(ana).toHaveAttribute("href", `/settings/sharing/${ids.myShare}`);
    expect(ana).toHaveAccessibleDescription("Precise · Live only · All devices Sees you");
  });

  it("says when nobody sees you, and shares with someone new", async () => {
    mockApi({ ...standardRoutes(), "GET /api/v1/shares": { status: 200, body: { shares: [] } } });
    const person = userEvent.setup();
    renderSettings("/settings/sharing");
    expect(await screen.findByText("Nobody sees your location.")).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Share my location" }));
    expect(screen.getByRole("dialog", { name: "Share my location" })).toBeInTheDocument();
  });

  it("shows what one person sees, to change or stop", async () => {
    let stopped = false;
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/v1/shares": () => ({
        status: 200,
        body: { shares: stopped ? [] : [outgoingShare()] },
      }),
      [`DELETE /api/v1/shares/${ids.myShare}`]: () => {
        stopped = true;
        return { status: 204 };
      },
    });
    const person = userEvent.setup();
    renderSettings(`/settings/sharing/${ids.myShare}`);
    expect(await heading("Ana Bell")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(facts()).toMatchObject({
      Status: "Sees you",
      Devices: "All devices",
      Precision: "Precise location",
      History: "Live only",
      "Battery and activity": "Shared",
      Ends: "When you stop it",
      "Last looked": expect.stringMatching(/^[45] min ago$/),
    });
    await person.click(screen.getByRole("button", { name: "Change what they see" }));
    const change = await screen.findByRole("dialog", { name: "Sharing with Ana Bell" });
    expect(within(change).getByRole("radio", { name: /No change/ })).toBeChecked();
    expect(within(change).queryByLabelText("Email address")).toBeNull();
    await person.click(within(change).getByRole("button", { name: "Cancel" }));

    await person.click(screen.getByRole("button", { name: "Stop sharing" }));
    const stop = await screen.findByRole("dialog", { name: "Stop sharing with Ana Bell?" });
    expect(within(stop).getByText(/no longer sees where you are/)).toBeInTheDocument();
    await person.click(within(stop).getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
    // Opened by its address: the list takes its place.
    expect(await heading("Sharing")).toBeInTheDocument();
    expect(await screen.findByText("Nobody sees your location.")).toBeInTheDocument();
  });

  it("asks to confirm whoever signed up with a waiting share's address", async () => {
    const nora = { email: "new@example.com", displayName: "Nora" };
    let confirmed = false;
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/v1/shares": () => ({
        status: 200,
        body: {
          shares: [
            confirmed
              ? outgoingShare({ recipient: { ...nora, userId: ids.bob } })
              : outgoingShare({ status: "joined", recipient: { ...nora, userId: null } }),
          ],
        },
      }),
      [`POST /api/v1/shares/${ids.myShare}/confirm`]: () => {
        confirmed = true;
        return {
          status: 200,
          body: { share: outgoingShare({ recipient: { ...nora, userId: ids.bob } }) },
        };
      },
    });
    const person = userEvent.setup();
    renderSettings(`/settings/sharing/${ids.myShare}`);
    expect(await heading("Nora")).toBeInTheDocument();
    expect(screen.getByText("Someone signed up as new@example.com")).toBeInTheDocument();
    expect(screen.getByText(/sees nothing until you confirm/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel the share" })).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Confirm it is Nora" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path.endsWith("/confirm"))).toBe(true),
    );
    expect(await screen.findByText("Sees you", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change what they see" })).toBeInTheDocument();
  });
});
