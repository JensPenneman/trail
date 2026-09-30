import { useId } from "react";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useSessionUser } from "../../app/useSessionUser";
import { PageHeader } from "../../ui/PageHeader";
import { AboutSection } from "./AboutSection";
import { DataSection } from "./DataSection";
import { PasskeyLinkSection } from "./PasskeyLinkSection";
import { PasskeysSection } from "./PasskeysSection";
import { PeopleSection } from "./PeopleSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsSection } from "./SessionsSection";
import "./SettingsPage.css";

/** Account, sign-in, people (admins), data and build information on one page. */
export function SettingsPage() {
  const user = useSessionUser();
  const ids = {
    profile: useId(),
    passkeys: useId(),
    link: useId(),
    sessions: useId(),
    people: useId(),
    data: useId(),
    about: useId(),
  };
  const contents: readonly { id: string; label: string }[] = [
    { id: ids.profile, label: "Profile" },
    { id: ids.passkeys, label: "Passkeys" },
    { id: ids.sessions, label: "Browsers" },
    ...(user.isAdmin ? [{ id: ids.people, label: "People" }] : []),
    { id: ids.data, label: "Data" },
    { id: ids.about, label: "About" },
  ];
  return (
    <div className="page page--narrow settings">
      <DocumentTitle title="Settings" />
      <PageHeader title="Settings" description={`Signed in as ${user.email}.`} />
      <nav className="settings__contents" aria-label="Settings sections">
        {contents.map((entry) => (
          <a key={entry.id} href={`#${entry.id}`}>
            {entry.label}
          </a>
        ))}
      </nav>
      <ProfileSection headingId={ids.profile} />
      <PasskeysSection headingId={ids.passkeys} />
      <PasskeyLinkSection headingId={ids.link} />
      <SessionsSection headingId={ids.sessions} />
      {user.isAdmin ? <PeopleSection headingId={ids.people} /> : null}
      <DataSection headingId={ids.data} />
      <AboutSection headingId={ids.about} />
    </div>
  );
}
