import { SettingsPage } from "../../settings/SettingsPage";
import { type SettingsPageId, settingsPage } from "../../settings/settingsTree";
import { EmptyState } from "../../ui/EmptyState";
import { LinkButton } from "../../ui/LinkButton";

interface MissingItemProps {
  parent: SettingsPageId;
  /** What one item is called: "Passkey", "API token". */
  item: string;
}

/** The page of an item that does not exist (any more): deleted elsewhere, or a wrong address. */
export function MissingItem({ parent, item }: MissingItemProps) {
  const above = settingsPage(parent);
  return (
    <SettingsPage parent={parent} title={`${item} not found`}>
      <EmptyState
        icon="warning"
        title={`There is no such ${item.charAt(0).toLowerCase()}${item.slice(1)} here`}
        action={
          <LinkButton to={above.path} icon="arrowLeft">
            {above.label}
          </LinkButton>
        }
      >
        <p>It may have been removed, or the address is not quite right.</p>
      </EmptyState>
    </SettingsPage>
  );
}
