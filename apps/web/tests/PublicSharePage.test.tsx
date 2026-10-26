import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublicSharePage } from "../src/pages/publicShare/PublicSharePage";
import { config } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

const secret = `trls_${"x".repeat(43)}`;
const path = "/api/public/share";

const page = (overrides: Record<string, unknown> = {}) => ({
  label: "Jens on the way home",
  expiresAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  precision: "approximate",
  historyDays: null,
  devices: [
    {
      key: "a1b2c3d4e5f60718",
      name: "Jens’s iPhone",
      location: {
        lat: 50.8502,
        lon: 4.3487,
        accuracy: 556,
        recordedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        speed: 9.7,
        course: null,
        altitude: null,
        precision: "approximate",
      },
      battery: { level: 0.44, state: "unplugged", recordedAt: new Date().toISOString() },
      activity: { motion: ["automotive"], tripMode: null, mode: null },
      track: null,
    },
  ],
  ...overrides,
});

const open = (hash = `#${secret}`) =>
  renderPage(<PublicSharePage />, { path: "/s", url: `/s${hash}`, user: null });

describe("PublicSharePage", () => {
  it("shows the label, the position's freshness and the expiry, without a session", async () => {
    const api = mockApi({
      "GET /api/config": { status: 200, body: config },
      [`GET ${path}`]: { status: 200, body: page() },
    });
    open();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Jens on the way home" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/approximate location, within about 500 m · updated every 15 seconds/),
    ).toBeInTheDocument();
    expect(screen.getByText("3 min ago")).toBeInTheDocument();
    expect(screen.getByText("35 km/h · driving")).toBeInTheDocument();
    expect(screen.getByText("44%")).toBeInTheDocument();
    expect(screen.getByText(/^This link expires (today at|on) .*\d\.$/)).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: /Map of the shared location of Jens’s iPhone/ }),
    ).toHaveAttribute("data-positions", "1");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(api.calls.map((call) => call.path)).not.toContain("/api/auth/session");
    // The secret travels in a header; no address the page asks for carries it.
    const asked = api.calls.find((call) => call.path === path);
    expect(asked?.headers?.["x-share-secret"]).toBe(secret);
    for (const call of api.calls) expect(call.url ?? "").not.toContain(secret);
  });

  it("draws the shared route when the link includes history", async () => {
    const start = Math.floor(Date.now() / 1000) - 3600;
    mockApi({
      "GET /api/config": { status: 200, body: config },
      [`GET ${path}`]: {
        status: 200,
        body: page({
          precision: "precise",
          historyDays: 1,
          devices: [
            {
              ...page().devices[0],
              track: [
                [4.34, 50.84, start, 3, 5, 10],
                [4.345, 50.845, start + 60, 3, 5, 10],
              ],
            },
          ],
        }),
      },
    });
    open();
    expect(await screen.findByRole("img", { name: /Map of the shared location/ })).toHaveAttribute(
      "data-tracks",
      "1",
    );
    expect(screen.getByText(/with the route of the last days/)).toBeInTheDocument();
  });

  it("says kindly that a link has ended", async () => {
    mockApi({
      "GET /api/config": { status: 200, body: config },
      [`GET ${path}`]: {
        status: 404,
        body: { error: { code: "share_expired", message: "This link has ended." } },
      },
    });
    open();
    expect(
      await screen.findByRole("heading", { level: 2, name: "This link has ended" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/stopped sharing it here, or the time they chose has passed/),
    ).toBeInTheDocument();
  });

  it("says that a link does not work when it is unknown", async () => {
    mockApi({
      "GET /api/config": { status: 200, body: config },
      [`GET ${path}`]: {
        status: 404,
        body: { error: { code: "not_found", message: "This link does not exist." } },
      },
    });
    open();
    expect(
      await screen.findByRole("heading", { level: 2, name: "This link does not work" }),
    ).toBeInTheDocument();
  });

  it("counts down in the link's last hour", async () => {
    mockApi({
      "GET /api/config": { status: 200, body: config },
      [`GET ${path}`]: {
        status: 200,
        body: page({ expiresAt: new Date(Date.now() + 25 * 60_000 + 30_000).toISOString() }),
      },
    });
    open();
    expect(await screen.findByText(/^This link expires .* \(in 26 min\)\.$/)).toBeInTheDocument();
  });

  it("says that a link does not work without a secret of the right shape, asking nobody", async () => {
    for (const hash of ["", "#", "#trls_short", "#%E0%A4%A"]) {
      const api = mockApi({ "GET /api/config": { status: 200, body: config } });
      const view = open(hash);
      expect(
        await screen.findByRole("heading", { level: 2, name: "This link does not work" }),
      ).toBeInTheDocument();
      expect(api.calls.some((call) => call.path === path)).toBe(false);
      view.unmount();
    }
  });

  it("ends by itself when the expiry passes on screen", async () => {
    mockApi({
      "GET /api/config": { status: 200, body: config },
      [`GET ${path}`]: {
        status: 200,
        body: page({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      },
    });
    open();
    expect(
      await screen.findByRole("heading", { level: 2, name: "This link has ended" }),
    ).toBeInTheDocument();
  });
});
