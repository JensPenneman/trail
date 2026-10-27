import { Navigate } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import { type SettingsSection as Section, settingsSections } from "../../app/settingsSections";
import { useSessionUser } from "../../app/useSessionUser";
import { AboutSection } from "./AboutSection";
import { ApiTokensSection } from "./ApiTokensSection";
import { DataSection } from "./DataSection";
import { PasskeyLinkSection } from "./PasskeyLinkSection";
import { PasskeysSection } from "./PasskeysSection";
import { PeopleSection } from "./PeopleSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsSection } from "./SessionsSection";
import { SharingSection } from "./SharingSection";

/**
 * One section of Settings. Headings keep fixed ids, so `/settings/passkeys#browsers`
 * scrolls to its part. A section only administrators have opens Profile for
 * everyone else.
 */
export function SettingsSection({ id }: { id: Section }) {
  const user = useSessionUser();
  const section = settingsSections.find((candidate) => candidate.id === id);
  if (section === undefined || (section.adminOnly && !user.isAdmin)) {
    return <Navigate to="/settings/profile" replace />;
  }
  return (
    <>
      <DocumentTitle title={`${section.label} · Settings`} />
      {id === "profile" ? <ProfileSection headingId="profile" /> : null}
      {id === "passkeys" ? (
        <>
          <PasskeysSection headingId="passkeys" />
          <PasskeyLinkSection headingId="passkey-link" />
          <SessionsSection headingId="browsers" />
        </>
      ) : null}
      {id === "tokens" ? <ApiTokensSection headingId="tokens" /> : null}
      {id === "sharing" ? <SharingSection headingId="sharing" /> : null}
      {id === "people" ? <PeopleSection headingId="people" /> : null}
      {id === "data" ? <DataSection headingId="data" /> : null}
      {id === "about" ? <AboutSection headingId="about" /> : null}
    </>
  );
}
