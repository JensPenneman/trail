import type { ReactNode } from "react";
import { ShellPage, type ShellUp } from "./ShellPage";
import { type SettingsPageId, settingsPage, settingsRootPath } from "./settingsTree";

interface SettingsPageProps {
  /** A page of the root list: title and description come from the tree. */
  page?: SettingsPageId;
  /** A page one level deeper: the page it belongs to, where its back control leads. */
  parent?: SettingsPageId;
  /**
   * A page of a part of an item, deeper still (a device's uploads): the
   * item's page, where its back control leads instead, and the item's name.
   */
  item?: { path: string; label: string };
  /** The title, when it is not the tree page's own (an item's name). */
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * A page of Settings: its title and the way back come from the tree (see
 * ShellPage). Beside the list the way back shows only for the pages of single
 * items and of their parts.
 */
export function SettingsPage({
  page,
  parent,
  item,
  title,
  description,
  children,
}: SettingsPageProps) {
  const node = page === undefined ? undefined : settingsPage(page);
  const above = parent === undefined ? undefined : settingsPage(parent);
  const shownTitle = title ?? node?.label ?? "Settings";
  const shownDescription = description ?? node?.description;
  const up: ShellUp | null =
    above !== undefined && item !== undefined
      ? { to: item.path, label: item.label, always: true }
      : above !== undefined
        ? { to: above.path, label: above.label, always: true }
        : node !== undefined
          ? { to: settingsRootPath, label: "Settings", always: false }
          : null;
  const documentTitle =
    above !== undefined && item !== undefined
      ? `${shownTitle} · ${item.label} · ${above.label} · Settings`
      : above !== undefined
        ? `${shownTitle} · ${above.label} · Settings`
        : node !== undefined
          ? `${shownTitle} · Settings`
          : "Settings";
  return (
    <ShellPage
      title={shownTitle}
      documentTitle={documentTitle}
      up={up}
      {...(shownDescription === undefined ? {} : { description: shownDescription })}
    >
      {children}
    </ShellPage>
  );
}
