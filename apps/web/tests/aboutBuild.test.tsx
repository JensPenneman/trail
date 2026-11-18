import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { AboutPage } from "../src/pages/settings/AboutPage";
import { seedEntry, warmClient } from "./support/cacheHarness";
import { config, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { createTestQueryClient, renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

async function showAbout(answer: typeof config) {
  mockApi(standardRoutes());
  const queryClient = createTestQueryClient();
  await warmClient(queryClient, user, async (seed) => {
    await seedEntry(seed, { user, queryKey: queryKeys.config, answer });
  });
  renderPage(<AboutPage />, { user, queryClient, path: "/settings/about" });
  const label = await screen.findByText("Built", { selector: "dt" });
  return label.nextElementSibling;
}

describe("Settings > About > Built", () => {
  it("shows the build date when there is one", async () => {
    const built = await showAbout(config);
    expect(built).toHaveTextContent("2026");
    expect(built).not.toHaveTextContent("Development build");
  });

  it("says Development build only for a development run", async () => {
    const built = await showAbout({ ...config, commit: "dev", builtAt: null });
    expect(built).toHaveTextContent("Development build");
  });

  it("does not call a deployed commit without a build time a development build", async () => {
    const built = await showAbout({ ...config, builtAt: null });
    expect(built).toHaveTextContent("Not recorded");
    expect(built).not.toHaveTextContent("Development build");
  });
});
