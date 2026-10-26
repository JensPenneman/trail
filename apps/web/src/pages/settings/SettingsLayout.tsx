import { NavLink, Outlet } from "react-router";
import { settingsSections } from "../../app/settingsSections";
import { useSessionUser } from "../../app/useSessionUser";
import { PageHeader } from "../../ui/PageHeader";
import { PlainList } from "../../ui/PlainList";
import "./SettingsLayout.css";

/**
 * Settings: the account, sign-in, API tokens, sharing, accounts
 * (administrators), data and the build, each section at an address of its own
 * under one header.
 */
export function SettingsLayout() {
  const user = useSessionUser();
  const sections = settingsSections.filter((section) => user.isAdmin || !section.adminOnly);
  return (
    <div className="page page--narrow settings">
      <PageHeader title="Settings" description={`Signed in as ${user.email}.`} />
      <nav className="settings__contents" aria-label="Settings sections">
        <PlainList className="settings__tabs">
          {sections.map((section) => (
            <li key={section.id}>
              <NavLink to={`/settings/${section.id}`} className="settings__tab">
                {section.label}
              </NavLink>
            </li>
          ))}
        </PlainList>
      </nav>
      <Outlet />
    </div>
  );
}
