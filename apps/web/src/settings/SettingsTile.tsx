import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/iconPaths";
import type { SettingsTone } from "./settingsTree";

/** The small coloured square with a row's icon; the row's label says what it means. */
export function SettingsTile({ icon, tone }: { icon: IconName; tone: SettingsTone }) {
  return (
    <span className={`settings-tile settings-tile--${tone}`}>
      <Icon name={icon} />
    </span>
  );
}
