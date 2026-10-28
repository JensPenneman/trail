import { type ReactNode, useId } from "react";
import { Link } from "react-router";
import { offlineReasonId, useReadOnly } from "../app/useReadOnly";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/iconPaths";
import { Spinner } from "../ui/Spinner";
import { Switch } from "../ui/Switch";
import { SettingsTile } from "./SettingsTile";
import type { SettingsTone } from "./settingsTree";
import { useSettingsLink } from "./useSettingsLink";

interface RowLook {
  label: string;
  /** An icon tile before the label; `tone` is its colour. */
  icon?: IconName;
  tone?: SettingsTone;
  /** A second line under the label. */
  detail?: ReactNode;
  /** On the right, before the chevron: a count, a state, a name. */
  value?: ReactNode;
}

interface LinkRow extends RowLook {
  kind: "link";
  /** A page of Settings; `#part` scrolls to that heading. */
  to: string;
  /** The page on screen, or the page above the one on screen (the sidebar). */
  current?: boolean;
}

interface ExternalRow extends RowLook {
  kind: "external";
  /** A page outside the app: the server's own (the API reference) or another site's. */
  href: string;
  /** Opens in a new tab (another site), and says so. */
  newTab?: boolean;
}

interface AwayRow extends RowLook {
  kind: "away";
  /**
   * A page of the app outside Settings (People's History): it leaves Settings,
   * so it has the arrow of a row that leaves, and keeps no way back here.
   */
  to: string;
}

/**
 * Rows that change something are off while the browser is offline, with the
 * offline banner as their reason (nothing is queued); `worksOffline` keeps on
 * the ones that change this browser only (its copy of the data).
 */
interface ChangeRow {
  worksOffline?: boolean;
}

interface ActionRow extends RowLook, ChangeRow {
  kind: "action";
  onClick: () => void;
  /** Red, for what removes or ends something. */
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
}

interface SwitchRow extends Omit<RowLook, "value">, ChangeRow {
  kind: "switch";
  checked: boolean;
  onChange: (checked: boolean) => void;
  busy?: boolean;
  disabled?: boolean;
}

interface SelectRow extends Omit<RowLook, "value">, ChangeRow {
  kind: "select";
  selected: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  busy?: boolean;
  disabled?: boolean;
}

interface PlainRow extends RowLook {
  kind: "plain";
  /** A control at the end of the row, such as a button. */
  end?: ReactNode;
  /** A quiet label, for the row that says a list is empty. */
  muted?: boolean;
}

export type SettingsRowProps =
  | LinkRow
  | ExternalRow
  | AwayRow
  | ActionRow
  | SwitchRow
  | SelectRow
  | PlainRow;

/** A row that opens a page of Settings: named by its label, described by the rest. */
function LinkRowBody({
  to,
  current,
  labelId,
  describedBy,
  children,
}: {
  to: string;
  current: boolean;
  labelId: string;
  describedBy: string | undefined;
  children: ReactNode;
}) {
  const link = useSettingsLink(to);
  return (
    <Link
      to={to}
      {...link}
      className="settings-row__body settings-row__body--interactive"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

/**
 * One row of a Settings group: an optional icon tile, the label (and a second
 * line), and what the row does — open a page (chevron), leave Settings or the
 * app (arrow), act at once, switch, choose, or nothing but show a value.
 */
export function SettingsRow(props: SettingsRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const detailId = `${id}-detail`;
  const valueId = `${id}-value`;
  const readOnly = useReadOnly();
  const off =
    (props.kind === "action" || props.kind === "switch" || props.kind === "select") &&
    readOnly &&
    props.worksOffline !== true;
  const value = "value" in props ? props.value : undefined;
  const describedBy =
    [
      props.detail === undefined ? null : detailId,
      value === undefined || value === null ? null : valueId,
      off ? offlineReasonId : null,
    ]
      .filter((part) => part !== null)
      .join(" ") || undefined;
  const tile =
    props.icon === undefined ? null : (
      <SettingsTile icon={props.icon} tone={props.tone ?? "gray"} />
    );
  const muted = props.kind === "plain" && props.muted === true;
  const text = (
    <span className="settings-row__text">
      <span
        className={muted ? "settings-row__label settings-row__label--muted" : "settings-row__label"}
        id={labelId}
      >
        {props.label}
      </span>
      {props.detail === undefined ? null : (
        <span className="settings-row__detail" id={detailId}>
          {props.detail}
        </span>
      )}
    </span>
  );
  const shownValue =
    value === undefined || value === null ? null : (
      <span className="settings-row__value" id={valueId}>
        {value}
      </span>
    );

  switch (props.kind) {
    case "link":
      return (
        <li className="settings-row">
          <LinkRowBody
            to={props.to}
            current={props.current === true}
            labelId={labelId}
            describedBy={describedBy}
          >
            {tile}
            {text}
            {shownValue}
            <Icon name="chevronRight" className="settings-row__chevron" />
          </LinkRowBody>
        </li>
      );
    case "external":
      return (
        <li className="settings-row">
          <a
            href={props.href}
            className="settings-row__body settings-row__body--interactive"
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            {...(props.newTab === true ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {tile}
            <span className="settings-row__text">
              <span className="settings-row__label" id={labelId}>
                {props.label}
                {props.newTab === true ? (
                  <>
                    {" "}
                    <span className="visually-hidden">(opens in a new tab)</span>
                  </>
                ) : null}
              </span>
              {props.detail === undefined ? null : (
                <span className="settings-row__detail" id={detailId}>
                  {props.detail}
                </span>
              )}
            </span>
            {shownValue}
            <Icon name="external" className="settings-row__chevron" />
          </a>
        </li>
      );
    case "away":
      return (
        <li className="settings-row">
          <Link
            to={props.to}
            className="settings-row__body settings-row__body--interactive"
            aria-labelledby={labelId}
            aria-describedby={describedBy}
          >
            {tile}
            {text}
            {shownValue}
            <Icon name="external" className="settings-row__chevron" />
          </Link>
        </li>
      );
    case "action":
      return (
        <li className="settings-row">
          <button
            type="button"
            className={`settings-row__body settings-row__body--interactive settings-row__action${props.danger === true ? " settings-row__action--danger" : ""}`}
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            disabled={props.disabled === true || props.busy === true || off}
            aria-busy={props.busy === true ? true : undefined}
            onClick={props.onClick}
          >
            {tile}
            {text}
            {shownValue}
            {props.busy === true ? <Spinner size="s" /> : null}
          </button>
        </li>
      );
    case "switch":
      return (
        <li className="settings-row">
          <div className="settings-row__body settings-row__body--switch">
            {tile}
            <Switch
              label={props.label}
              description={props.detail}
              checked={props.checked}
              disabled={props.disabled === true || off}
              busy={props.busy === true}
              {...(off ? { describedBy: offlineReasonId } : {})}
              onChange={props.onChange}
            />
          </div>
        </li>
      );
    case "select":
      return (
        <li className="settings-row">
          <div className="settings-row__body">
            {tile}
            <span className="settings-row__text">
              <label className="settings-row__label" htmlFor={id}>
                {props.label}
              </label>
              {props.detail === undefined ? null : (
                <span className="settings-row__detail" id={detailId}>
                  {props.detail}
                </span>
              )}
            </span>
            <span className="settings-row__select">
              <select
                id={id}
                value={props.selected}
                disabled={props.disabled === true || props.busy === true || off}
                aria-busy={props.busy === true ? true : undefined}
                aria-describedby={
                  [props.detail === undefined ? null : detailId, off ? offlineReasonId : null]
                    .filter((part) => part !== null)
                    .join(" ") || undefined
                }
                onChange={(event) => props.onChange(event.currentTarget.value)}
              >
                {props.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" className="settings-row__select-chevron" />
            </span>
          </div>
        </li>
      );
    case "plain":
      return (
        <li className="settings-row">
          <div className="settings-row__body">
            {tile}
            {text}
            {shownValue}
            {props.end === undefined ? null : (
              <span className="settings-row__end">{props.end}</span>
            )}
          </div>
        </li>
      );
  }
}

/** A label and its value in a `facts` group (a description list). */
export function SettingsFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-row settings-row__body settings-fact">
      <dt className="settings-fact__label">{label}</dt>
      <dd className="settings-fact__value">{children}</dd>
    </div>
  );
}
