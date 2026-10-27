import { type APIRequestContext, expect } from "@playwright/test";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiTokenSecretPattern } from "@trail/contracts/apiToken";
import { listDevicesOutputSchema } from "@trail/contracts/mcp";
import { expectAccessible } from "./support/expectAccessible";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/** One JSON-RPC message to /mcp, as a 2025-era MCP client sends it, and its answer. */
async function mcp(request: APIRequestContext, secret: string, message: object) {
  const response = await request.post(apiPaths.mcp, {
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    data: message,
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/json/);
  return (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
}

test.describe("MCP server", () => {
  test("serves an agent with a token made from the Agent template", async ({
    page,
    account,
    request,
  }) => {
    await uploadedDevice(page, "Agent's phone", overlandBatch(account.timezone));

    // Settings › MCP: how to connect, and the Agent template a click away.
    await page.goto("/settings/mcp");
    await expect(
      page.getByRole("link", { name: "MCP guide (opens in a new tab)" }),
    ).toHaveAttribute("href", /docs\/mcp\.md$/);
    await expect(page.getByRole("textbox", { name: "Server address" })).toHaveValue(
      new URL(apiPaths.mcp, page.url()).href,
    );
    await expectAccessible(page, "Settings › MCP");
    await page.getByRole("button", { name: "Create an Agent token" }).click();
    const form = page.getByRole("dialog", { name: "Create an API token" });
    await expect(form.getByRole("radio", { name: "Agent" })).toBeChecked();
    await form.getByLabel("Name").fill("Appointments");
    await expect(form.getByRole("link", { name: "MCP server" })).toHaveAttribute(
      "href",
      /docs\/mcp\.md$/,
    );
    await expectAccessible(page, "the create-token dialog with the Agent template");
    await form.getByRole("button", { name: "Create token" }).click();
    const shown = page.getByRole("dialog", { name: "Copy the token “Appointments”" });
    const secret = await shown.getByRole("textbox", { name: "API token" }).inputValue();
    expect(secret).toMatch(apiTokenSecretPattern);
    await shown.getByRole("button", { name: "I have saved it" }).click();

    // The `request` fixture has no session: the token is the agent's only credential.
    const hello = await mcp(request, secret, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1.0.0" },
      },
    });
    expect(hello.result).toMatchObject({ serverInfo: { name: "trail" } });
    const listed = await mcp(request, secret, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = ((listed.result?.["tools"] ?? []) as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["list_devices", "get_current_location", "get_timeline"]),
    );
    const called = await mcp(request, secret, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_devices", arguments: {} },
    });
    const { devices } = listDevicesOutputSchema.parse(called.result?.["structuredContent"]);
    expect(devices.map((device) => device.name)).toEqual(["Agent's phone"]);

    // Without the token, the signed-in browser's own session is no way in.
    const anonymous = await page.request.post(apiPaths.mcp, {
      headers: { "Content-Type": "application/json" },
      data: { jsonrpc: "2.0", id: 4, method: "tools/list" },
    });
    expect(anonymous.status()).toBe(401);
  });
});
