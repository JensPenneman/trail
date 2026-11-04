import type { Person } from "@trail/contracts/person";
import { useFormatter } from "../format/useFormatter";
import { expiryText, historyText, precisionInfo } from "../sharing/shareText";
import "./PersonDetails.css";

/** What someone shares with you: the precision, how far back, details, until when and since when. */
export function ShareTerms({ person, now }: { person: Person; now: number }) {
  const format = useFormatter();
  const { share } = person;
  return (
    <dl className="person-details__facts">
      <div>
        <dt>Precision</dt>
        <dd>{precisionInfo[share.precision].short}</dd>
      </div>
      <div>
        <dt>Where they’ve been</dt>
        <dd>{historyText(share.historyDays)}</dd>
      </div>
      <div>
        <dt>Battery and activity</dt>
        <dd>{share.includeDetails ? "Shared" : "Not shared"}</dd>
      </div>
      <div>
        <dt>Until</dt>
        <dd>
          {share.expiresAt === null ? "No end set" : expiryText(share.expiresAt, format, now)}
        </dd>
      </div>
      <div>
        <dt>Since</dt>
        <dd>{format.dayTime(share.createdAt)}</dd>
      </div>
    </dl>
  );
}
