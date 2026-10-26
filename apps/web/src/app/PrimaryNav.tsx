import { Link, useMatch } from "react-router";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/iconPaths";
import { PlainList } from "../ui/PlainList";
import "./PrimaryNav.css";

interface NavItem {
  to: string;
  /** The addresses the item stands for; it is current on all of them. */
  match: { path: string; end: boolean };
  label: string;
  icon: IconName;
}

const items: readonly NavItem[] = [
  { to: "/", match: { path: "/", end: true }, label: "Map", icon: "map" },
  { to: "/people", match: { path: "/people", end: false }, label: "People", icon: "users" },
  { to: "/devices", match: { path: "/devices", end: false }, label: "Devices", icon: "devices" },
  // Straight to the first section: `/settings` itself only redirects there.
  {
    to: "/settings/profile",
    match: { path: "/settings", end: false },
    label: "Settings",
    icon: "settings",
  },
];

function PrimaryNavLink({ item }: { item: NavItem }) {
  const current = useMatch(item.match) !== null;
  return (
    <Link to={item.to} className="primary-nav__link" aria-current={current ? "page" : undefined}>
      <Icon name={item.icon} className="primary-nav__icon" />
      <span className="primary-nav__label">{item.label}</span>
    </Link>
  );
}

/**
 * The one navigation landmark: part of the header on wide screens, a bottom
 * tab bar within thumb reach on phones (same element, restyled — so focus
 * order and landmarks never differ between the two). The current item says so
 * to assistive technology (`aria-current="page"`), on every address below it.
 */
export function PrimaryNav() {
  return (
    <nav className="primary-nav" aria-label="Main">
      <PlainList className="primary-nav__list">
        {items.map((item) => (
          <li key={item.to}>
            <PrimaryNavLink item={item} />
          </li>
        ))}
      </PlainList>
    </nav>
  );
}
