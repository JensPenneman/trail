import { apiPaths } from "@trail/contracts/apiPaths";
import { useState } from "react";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { CopyField } from "../../ui/CopyField";
import { CreateApiTokenDialog } from "./CreateApiTokenDialog";
import { mcpGuideUrl } from "./mcpGuide";
import "./settings.css";

/** A client configuration in the shape most MCP clients read (docs/mcp.md › Connect). */
const configuration = (address: string) =>
  JSON.stringify(
    {
      mcpServers: {
        trail: { type: "http", url: address, headers: { Authorization: "Bearer trlk_…" } },
      },
    },
    null,
    2,
  );

/**
 * Settings › MCP: how to connect an agent to this server's MCP endpoint
 * (docs/mcp.md) — a token from the Agent template, the address, the header —
 * with a shortcut to that token.
 */
export function McpPage() {
  const [creating, setCreating] = useState(false);
  const address = `${window.location.origin}${apiPaths.mcp}`;
  return (
    <SettingsPage page="mcp">
      <SettingsGroup
        title="1. A token for the agent"
        footer="Every read permission, and telling Trail how you travel now. Leave out what the agent does not need, limit it to some devices, and give it an expiry."
      >
        <SettingsRow
          kind="action"
          icon="plus"
          tone="pink"
          label="Create an Agent token"
          onClick={() => setCreating(true)}
        />
      </SettingsGroup>
      <SettingsGroup title="2. Connect the client" id="connect" variant="card">
        <CopyField label="Server address" value={address} mono={false} />
        <p>
          Any client that speaks MCP over Streamable HTTP and can send a header works. It sends the
          token with every request:
        </p>
        <pre className="settings__code">
          <code>Authorization: Bearer trlk_…</code>
        </pre>
        <p>Many clients read a configuration like this one, with your token in its place:</p>
        <pre className="settings__code">
          <code>{configuration(address)}</code>
        </pre>
      </SettingsGroup>
      <SettingsGroup title="More">
        <SettingsRow
          kind="external"
          href={mcpGuideUrl}
          newTab
          icon="book"
          tone="blue"
          label="MCP guide"
          detail="The tools, their limits, privacy and troubleshooting"
        />
        <SettingsRow
          kind="link"
          to="/settings/tokens"
          icon="code"
          tone="gray"
          label="API tokens"
          detail="Roll or revoke the agent's token"
        />
      </SettingsGroup>
      <CreateApiTokenDialog open={creating} onClose={() => setCreating(false)} template="agent" />
    </SettingsPage>
  );
}
