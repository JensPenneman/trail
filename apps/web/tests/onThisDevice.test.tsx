import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { OfflineBanner } from "../src/app/OfflineBanner";
import { AboutPage } from "../src/pages/settings/AboutPage";
import { PreferencesPage } from "../src/pages/settings/PreferencesPage";
import { seedEntry, warmClient } from "./support/cacheHarness";
import { config, device, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { createTestQueryClient, renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

afterEach(() => {
  window.localStorage.clear();
});

async function withCopy() {
  const queryClient = createTestQueryClient();
  const { cache, store } = await warmClient(queryClient, user, async (seed) => {
    await seedEntry(seed, { user, queryKey: queryKeys.config, answer: config });
    await seedEntry(seed, { user, queryKey: queryKeys.devices, answer: { devices: [device()] } });
  });
  return { queryClient, cache, store };
}

const group = () => screen.getByRole("list", { name: "On this device" });

describe("Settings › Preferences › On this device", () => {
  it("keeps a copy by default, says how large it is, and turns it off with the copy gone", async () => {
    mockApi(standardRoutes());
    const { queryClient, store } = await withCopy();
    const person = userEvent.setup();
    renderPage(<PreferencesPage />, { user, queryClient, path: "/settings/preferences" });
    const toggle = await screen.findByRole("switch", {
      name: "Keep a copy of your data on this device",
    });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      "Shows your map at once when you open Trail and works when you are offline. Turn it off on a shared computer.",
    );
    const bytes = (await store.readMeta())?.bytes ?? 0;
    expect(bytes).toBeGreaterThan(0);
    expect(await within(group()).findByText(/\d kB$/)).toBeInTheDocument();

    await person.click(toggle);
    expect(await screen.findByText("The copy on this device is deleted.")).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(await store.list()).toEqual([]);
    expect(window.localStorage.getItem("trail.cache")).toBe("off");
    expect(within(group()).getByRole("button", { name: "Clear the copy" })).toBeDisabled();
    expect(await within(group()).findByText("0 byte")).toBeInTheDocument();
  });

  it("clears the copy and keeps on keeping one", async () => {
    mockApi(standardRoutes());
    const { queryClient, cache, store } = await withCopy();
    const person = userEvent.setup();
    renderPage(<PreferencesPage />, { user, queryClient, path: "/settings/preferences" });
    await person.click(await screen.findByRole("button", { name: "Clear the copy" }));
    expect(await screen.findByText("The copy on this device is cleared.")).toBeInTheDocument();
    expect(await store.list()).toEqual([]);
    expect(screen.getByRole("switch", { name: /Keep a copy/ })).toBeChecked();
    // Bound to the person again: what the pages load next is kept.
    expect(cache.state()).toMatchObject({ on: true, owner: user.id });
    queryClient.setQueryData(queryKeys.devices, { devices: [device()] });
    cache.persistNow(queryKeys.devices);
    await expect.poll(async () => (await store.list()).length).toBe(1);
  });

  it("works offline, where every row that changes the account is off with the reason", async () => {
    mockApi(standardRoutes());
    const { queryClient } = await withCopy();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderPage(
      <>
        <OfflineBanner />
        <PreferencesPage />
      </>,
      { user, queryClient, path: "/settings/preferences" },
    );
    const style = await screen.findByRole("combobox", { name: "Map style" });
    expect(style).toBeDisabled();
    expect(style).toHaveAccessibleDescription(/You’re offline\. Trail shows what it kept/);
    expect(screen.getByRole("switch", { name: "Your own activity" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Keep a copy/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clear the copy" })).toBeEnabled();
  });
});

describe("Settings › About › On this device", () => {
  it("shows what the copy did during this visit, and what the server's processing is", async () => {
    mockApi(standardRoutes());
    const { queryClient } = await withCopy();
    const { liveStore } = renderPage(<AboutPage />, { user, queryClient, path: "/settings/about" });
    act(() => liveStore.setServer({ versions: { averaged: 2, mapped: 3, inferred: 4 } }));
    const facts = (await screen.findByRole("heading", { name: "On this device" })).parentElement;
    if (facts === null) throw new Error("no On this device");
    const fact = (label: string) =>
      within(facts).getByText(label, { selector: "dt" }).nextElementSibling;
    await waitFor(() => expect(fact("Copy of your data")).toHaveTextContent("On"));
    expect(fact("Restored this visit")).toHaveTextContent(/^2 answers, /);
    expect(fact("Shown from the copy")).toHaveTextContent("2");
    expect(fact("Processing on the server")).toHaveTextContent(
      "Averaged 2 · mapped 3 · inferred 4",
    );
  });

  it("says the copy is off when this browser keeps none", async () => {
    mockApi(standardRoutes());
    const { queryClient, cache } = await withCopy();
    await cache.setOn(false);
    renderPage(<AboutPage />, { user, queryClient, path: "/settings/about" });
    const heading = await screen.findByRole("heading", { name: "On this device" });
    const facts = heading.parentElement;
    if (facts === null) throw new Error("no On this device");
    expect(
      within(facts).getByText("Copy of your data", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("Off: nothing is kept on this device");
  });
});
