import { NavLink } from "react-router";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/iconPaths";
import { PlainList } from "../ui/PlainList";
import "./PrimaryNav.css";

const items: readonly { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Live", icon: "live", end: true },
  { to: "/history", label: "History", icon: "history" },
  { to: "/explore", label: "Explore", icon: "explore" },
  { to: "/devices", label: "Devices", icon: "devices" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

/**
 * The one navigation landmark: part of the header on wide screens, a bottom
 * tab bar within thumb reach on phones (same element, restyled — so focus
 * order and landmarks never differ between the two).
 */
export function PrimaryNav() {
  return (
    <nav className="primary-nav" aria-label="Main">
      <PlainList className="primary-nav__list">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end === true} className="primary-nav__link">
              <Icon name={item.icon} className="primary-nav__icon" />
              <span className="primary-nav__label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </PlainList>
    </nav>
  );
}
