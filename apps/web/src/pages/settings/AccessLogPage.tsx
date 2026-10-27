import { dataAccessActorKinds, dataAccessChannels } from "@trail/contracts/dataAccess";
import { useSearchParams } from "react-router";
import { AboutTheLog } from "../../accessLog/AboutTheLog";
import { AccessLines } from "../../accessLog/AccessLines";
import { actionChoices, actorKindLabels, channelLabels } from "../../accessLog/accessActions";
import {
  type AccessLogSearch,
  accessLogDays,
  accessLogParams,
  isFiltered,
  parseAccessLogSearch,
  shownSearch,
  withAccessLogFilter,
} from "../../accessLog/accessLogSearch";
import { OwnActivitySwitch } from "../../accessLog/OwnActivitySwitch";
import { useOwnActivity } from "../../accessLog/useOwnActivity";
import { useResourceNames } from "../../accessLog/useResourceNames";
import { useSessionUser } from "../../app/useSessionUser";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { useToday } from "../../time/useToday";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { SelectField } from "../../ui/SelectField";
import "./AccessLogPage.css";

const periodLabels: Readonly<Record<(typeof accessLogDays)[number], string>> = {
  1: "Today",
  7: "Last 7 days",
  30: "Last 30 days",
  90: "Last 90 days",
};

/** The filters, each a select that changes its own part of the address. */
function AccessLogFilters({
  search,
  showOwn,
  onChange,
}: {
  search: AccessLogSearch;
  showOwn: boolean;
  onChange: (change: Partial<AccessLogSearch>) => void;
}) {
  const actors = dataAccessActorKinds.filter((kind) => showOwn || kind !== "owner");
  const channels = dataAccessChannels.filter((channel) => showOwn || channel !== "web");
  const listed = actionChoices.some((group) =>
    group.actions.some((choice) => choice.action === search.action),
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of filters, not a form with a legend to read
    <div className="access-filters" role="group" aria-label="Filters">
      <SelectField
        label="Who"
        value={search.actor ?? ""}
        onChange={(event) =>
          onChange({ actor: (event.currentTarget.value || null) as AccessLogSearch["actor"] })
        }
      >
        <option value="">Everyone</option>
        {actors.map((kind) => (
          <option key={kind} value={kind}>
            {actorKindLabels[kind]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Through"
        value={search.channel ?? ""}
        onChange={(event) =>
          onChange({
            channel: (event.currentTarget.value || null) as AccessLogSearch["channel"],
          })
        }
      >
        <option value="">Any channel</option>
        {channels.map((channel) => (
          <option key={channel} value={channel}>
            {channelLabels[channel]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Period"
        value={search.days === null ? "" : String(search.days)}
        onChange={(event) => {
          const value = event.currentTarget.value;
          onChange({ days: value === "" ? null : (Number(value) as AccessLogSearch["days"]) });
        }}
      >
        <option value="">Everything</option>
        {accessLogDays.map((days) => (
          <option key={days} value={days}>
            {periodLabels[days]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Action"
        value={search.action ?? ""}
        onChange={(event) => onChange({ action: event.currentTarget.value || null })}
      >
        <option value="">Any action</option>
        {actionChoices.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.actions.map((choice) => (
              <option key={choice.action} value={choice.action}>
                {choice.label}
              </option>
            ))}
          </optgroup>
        ))}
        {search.action === null || listed ? null : (
          <option value={search.action}>{search.action}</option>
        )}
      </SelectField>
    </div>
  );
}

/**
 * Settings › Access log: every read of the person's data and every change to
 * it or to who may see it, newest first, a line per hour and kind of access —
 * filtered by who, channel, period and action; one's own activity only when
 * they choose so. More lines come as the list is scrolled to its end.
 */
export function AccessLogPage() {
  const [params, setParams] = useSearchParams();
  const own = useOwnActivity();
  const today = useToday();
  const { timezone } = useSessionUser();
  const names = useResourceNames();
  const search = shownSearch(parseAccessLogSearch(params), own.showOwn);
  const filtered = isFiltered(search);
  const change = (next: Partial<AccessLogSearch>) =>
    setParams((current) => withAccessLogFilter(current, next));
  const clear = () => change({ actor: null, channel: null, days: null, action: null });
  return (
    <SettingsPage page="access-log">
      <AccessLogFilters search={search} showOwn={own.showOwn} onChange={change} />
      {filtered ? (
        <div className="access-filters__clear">
          <Button variant="ghost" icon="close" onClick={clear}>
            Clear filters
          </Button>
        </div>
      ) : null}
      <OwnActivitySwitch own={own} />
      <AccessLines
        params={accessLogParams(search, { showOwn: own.showOwn, today, timeZone: timezone })}
        showActor
        names={names}
        headingLevel={2}
        empty={
          <SettingsGroup variant="card">
            {filtered ? (
              <EmptyState
                icon="history"
                title="No lines match these filters"
                action={<Button onClick={clear}>Clear filters</Button>}
              >
                <p>Choose another period or fewer filters.</p>
              </EmptyState>
            ) : (
              <EmptyState icon="history" title="Nothing recorded yet">
                <p>
                  When someone you share with looks at you, a visitor opens one of your public links
                  or one of your API tokens reads your data, it shows here
                  {own.showOwn ? ", and so does what you do yourself" : ""}.
                </p>
              </EmptyState>
            )}
          </SettingsGroup>
        }
      />
      <AboutTheLog id="recorded" />
      <SettingsGroup title="Related">
        <SettingsRow
          kind="link"
          to="/settings/privacy/viewers"
          icon="eye"
          tone="purple"
          label="Who viewed you"
          detail="Who looked, how often, per day"
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
