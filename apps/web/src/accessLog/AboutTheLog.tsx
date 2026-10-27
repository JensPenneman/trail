import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingsRow } from "../settings/SettingsRow";

/** The guides about the log, in the repository (the image carries no documentation besides the API's). */
const sharingGuideUrl =
  "https://github.com/JensPenneman/trail/blob/main/docs/sharing.md#change-or-stop";
const apiGuideUrl = "https://github.com/JensPenneman/trail/blob/main/docs/api.md#access-log";

/**
 * What the log records and what it never does, in short, with the guides
 * that say it in full: for the pages of the access log.
 */
export function AboutTheLog({ id }: { id?: string }) {
  return (
    <SettingsGroup
      title="What is recorded"
      {...(id === undefined ? {} : { id })}
      footer={
        <>
          <p>
            Every time your data is read — by you in a browser, by your API tokens and agents, by
            the people you share with, or on your public links — and every change to it or to who
            may see it, counted per hour: who, through what, which data and when. Never where you
            were, and of the people you share with never their devices, browsers or addresses. A
            link's visitors are known only by their network and kind of browser.
          </p>
          <p>Only you can see your log. Lines are kept for a year.</p>
        </>
      }
    >
      <SettingsRow
        kind="external"
        href={sharingGuideUrl}
        newTab
        icon="book"
        tone="green"
        label="Sharing guide"
        detail="What the people you share with know about it"
      />
      <SettingsRow
        kind="external"
        href={apiGuideUrl}
        newTab
        icon="book"
        tone="blue"
        label="API guide: Access log"
        detail="Every channel and what it records, and reading the log with a token"
      />
    </SettingsGroup>
  );
}
