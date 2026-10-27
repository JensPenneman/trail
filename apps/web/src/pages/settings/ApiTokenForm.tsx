import { type ApiScope, apiScopeDescriptions, apiScopes } from "@trail/contracts/apiScope";
import {
  type ApiTokenTemplate,
  type ApiTokenWithSecretResponse,
  apiTokenTemplates,
  maxAllowedIpNetworks,
  templateOfScopes,
} from "@trail/contracts/apiToken";
import { ipNetworkProblem } from "@trail/contracts/ipNetwork";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ApiError } from "../../api/ApiError";
import { useSessionUser } from "../../app/useSessionUser";
import { useFormatter } from "../../format/useFormatter";
import { useCreateApiToken } from "../../queries/useCreateApiToken";
import { useDevices } from "../../queries/useDevices";
import { addDays } from "../../time/addDays";
import { useNow } from "../../time/useNow";
import { useToday } from "../../time/useToday";
import { Button } from "../../ui/Button";
import { errorMessage } from "../../ui/errorMessage";
import { Icon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import { mcpGuideUrl } from "./mcpGuide";
import { TokenChoice } from "./TokenChoice";
import { type ExpiryChoice, expiryChoices, expiryInstant } from "./tokenExpiry";
import "./ApiTokens.css";

const templates: readonly { value: ApiTokenTemplate; label: string; description: ReactNode }[] = [
  {
    value: "read-only",
    label: "Read-only",
    description: "Reads everything a token can read, positions included; changes nothing.",
  },
  {
    value: "agent",
    label: "Agent",
    description: (
      <>
        Read-only but for the access log, and may correct how you travelled: for an agent that plans
        with you, connected to Trail's{" "}
        <a href={mcpGuideUrl} target="_blank" rel="noreferrer">
          MCP server
        </a>
        .
      </>
    ),
  },
  {
    value: "full",
    label: "Full access",
    description: "Everything a token can do. Signing in, tokens and device credentials stay yours.",
  },
];

const scopeGroups: readonly { legend: string; scopes: readonly ApiScope[] }[] = [
  { legend: "Read", scopes: apiScopes.filter((scope) => scope.endsWith(":read")) },
  { legend: "Write", scopes: apiScopes.filter((scope) => scope.endsWith(":write")) },
];

type Problems = Partial<Record<"name" | "scopes" | "devices" | "expiry" | "ips", string>>;

/** The networks typed into the allowlist field: separated by commas, spaces or new lines. */
const networksOf = (text: string): string[] =>
  text.split(/[\s,]+/).filter((entry) => entry.length > 0);

/** API field errors on the form's fields (`allowedIps.2` belongs to the address field). */
function problemsFrom(error: ApiError): Problems {
  const problems: Problems = {};
  for (const [field, messages] of Object.entries(error.fields)) {
    const message = messages.join(" ");
    if (field === "name") problems.name = message;
    else if (field.startsWith("scopes")) problems.scopes = message;
    else if (field.startsWith("deviceIds")) problems.devices = message;
    else if (field.startsWith("allowedIps")) problems.ips = message;
    else if (field === "expiresAt") problems.expiry = message;
  }
  if (error.code === "not_found") problems.devices = "One of these devices no longer exists.";
  return problems;
}

/** A problem under a group of controls, announced with it. */
function GroupProblem({ id, problem }: { id: string; problem: string | undefined }) {
  if (problem === undefined) return null;
  return (
    <p className="field__error" id={id}>
      <Icon name="warning" />
      <span>{problem}</span>
    </p>
  );
}

interface ApiTokenFormProps {
  /** The template whose scopes the form starts with. */
  template?: ApiTokenTemplate;
  onCreated: (created: ApiTokenWithSecretResponse) => void;
  onCancel: () => void;
}

/**
 * The settings of a new token: a name, what it may do (a template fills in
 * the scopes, which can then be adjusted), its devices, when it expires and,
 * optionally, the addresses it may be used from.
 */
export function ApiTokenForm({
  template: initial = "read-only",
  onCreated,
  onCancel,
}: ApiTokenFormProps) {
  const ids = {
    template: useId(),
    devices: useId(),
    devicesProblem: useId(),
    scopesProblem: useId(),
  };
  const format = useFormatter();
  const { timezone } = useSessionUser();
  const today = useToday();
  const now = useNow(60_000);
  const devices = useDevices();
  const create = useCreateApiToken();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<readonly ApiScope[]>(apiTokenTemplates[initial]);
  const [deviceMode, setDeviceMode] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryChoice>("30-days");
  const [date, setDate] = useState(addDays(today, 30));
  const [ips, setIps] = useState("");
  const [ipsOpen, setIpsOpen] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const report = (found: Problems) => {
    setProblems(found);
    // A problem in the collapsed part must not stay hidden.
    if (found.ips !== undefined) setIpsOpen(true);
  };

  const template = templateOfScopes(scopes);
  const ownDevices = devices.data ?? [];
  const expiresAt =
    expiry === "date" && date < today
      ? null
      : expiryInstant(expiry, { now, date, timeZone: timezone });

  const toggleScope = (scope: ApiScope, on: boolean) =>
    setScopes(
      apiScopes.filter((candidate) => (candidate === scope ? on : scopes.includes(candidate))),
    );
  const toggleDevice = (deviceId: string, on: boolean) =>
    setPicked(
      ownDevices
        .map((device) => device.id)
        .filter((candidate) => (candidate === deviceId ? on : picked.includes(candidate))),
    );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    const networks = networksOf(ips);
    const networkProblem = networks
      .map((network) => ipNetworkProblem(network))
      .find((problem) => problem !== null);
    const found: Problems = {
      ...(trimmed === "" || trimmed.length > 60 ? { name: "Use 1 to 60 characters." } : {}),
      ...(scopes.length === 0 ? { scopes: "Choose at least one permission." } : {}),
      ...(deviceMode === "some" && picked.length === 0
        ? { devices: "Pick at least one device, or allow them all." }
        : {}),
      ...(expiry === "date" && (date === "" || date < today)
        ? { expiry: "Pick today or a day after it." }
        : {}),
      ...(networkProblem === undefined
        ? networks.length > maxAllowedIpNetworks
          ? { ips: `At most ${maxAllowedIpNetworks} addresses or networks.` }
          : {}
        : { ips: networkProblem }),
    };
    report(found);
    if (Object.keys(found).length > 0) return;
    create.mutate(
      {
        name: trimmed,
        scopes: [...scopes],
        deviceIds: deviceMode === "all" ? null : [...picked],
        allowedIps: networks.length === 0 ? null : networks,
        expiresAt: expiryInstant(expiry, { now: Date.now(), date, timeZone: timezone }),
      },
      {
        onSuccess: onCreated,
        onError: (error) => {
          if (error instanceof ApiError) report(problemsFrom(error));
        },
      },
    );
  };

  // Field problems are shown on the fields; anything else (the limit, the network) gets a notice.
  const generalError =
    create.error instanceof ApiError &&
    (Object.keys(create.error.fields).length > 0 || create.error.code === "not_found")
      ? null
      : create.error;

  return (
    <form className="token-form" onSubmit={onSubmit} noValidate>
      <TextField
        label="Name"
        hint="Where it is used, e.g. “Home Assistant” or “Calendar agent”."
        value={name}
        maxLength={60}
        required
        autoComplete="off"
        data-autofocus
        error={problems.name ?? null}
        onChange={(event) => setName(event.currentTarget.value)}
      />

      <fieldset className="token-options">
        <legend className="field__label">Permissions</legend>
        {templates.map((option) => (
          <TokenChoice
            key={option.value}
            type="radio"
            look="option"
            name={ids.template}
            label={option.label}
            description={option.description}
            checked={template === option.value}
            onChange={() => setScopes(apiTokenTemplates[option.value])}
          />
        ))}
      </fieldset>

      <fieldset
        className="token-scopes"
        aria-describedby={problems.scopes === undefined ? undefined : ids.scopesProblem}
      >
        <legend className="field__label">
          Scopes{template === null ? " (your own selection)" : ""}
        </legend>
        <div className="token-scopes__groups">
          {scopeGroups.map((group) => (
            <fieldset key={group.legend} className="token-scopes__group">
              <legend className="token-scopes__legend">{group.legend}</legend>
              {group.scopes.map((scope) => (
                <TokenChoice
                  key={scope}
                  type="checkbox"
                  look="scope"
                  label={scope}
                  description={apiScopeDescriptions[scope]}
                  checked={scopes.includes(scope)}
                  onChange={(checked) => toggleScope(scope, checked)}
                />
              ))}
            </fieldset>
          ))}
        </div>
        <GroupProblem id={ids.scopesProblem} problem={problems.scopes} />
      </fieldset>

      <fieldset
        className="token-options"
        aria-describedby={problems.devices === undefined ? undefined : ids.devicesProblem}
      >
        <legend className="field__label">Devices</legend>
        <TokenChoice
          type="radio"
          look="option"
          name={ids.devices}
          label="All devices"
          description="Also the ones you add later."
          checked={deviceMode === "all"}
          onChange={() => setDeviceMode("all")}
        />
        <TokenChoice
          type="radio"
          look="option"
          name={ids.devices}
          label="Only some devices"
          description={
            ownDevices.length === 0
              ? "You have no devices yet."
              : "The others do not exist for the token."
          }
          checked={deviceMode === "some"}
          disabled={ownDevices.length === 0}
          onChange={() => setDeviceMode("some")}
        />
        {deviceMode === "some" ? (
          <fieldset className="token-devices">
            <legend className="visually-hidden">The token's devices</legend>
            {ownDevices.map((device) => (
              <label key={device.id} className="token-device">
                <input
                  type="checkbox"
                  checked={picked.includes(device.id)}
                  onChange={(event) => toggleDevice(device.id, event.currentTarget.checked)}
                />
                <span>{device.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <GroupProblem id={ids.devicesProblem} problem={problems.devices} />
      </fieldset>

      <div className="token-expiry">
        <SelectField
          label="Expires"
          value={expiry}
          hint={
            expiresAt === null
              ? expiry === "never"
                ? "It works until you revoke it."
                : undefined
              : `It stops working on ${format.dateTime(expiresAt)}.`
          }
          error={expiry === "date" ? null : (problems.expiry ?? null)}
          onChange={(event) => {
            const next = expiryChoices.find((choice) => choice.value === event.currentTarget.value);
            if (next !== undefined) setExpiry(next.value);
          }}
        >
          {expiryChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </SelectField>
        {expiry === "date" ? (
          <TextField
            label="Last day it works"
            type="date"
            min={today}
            value={date}
            error={problems.expiry ?? null}
            onChange={(event) => setDate(event.currentTarget.value)}
          />
        ) : null}
      </div>
      {expiry === "never" ? (
        <Notice tone="warning" title="A token without an expiry">
          <p>
            It keeps working until you revoke it, also when it leaks unnoticed. Prefer an expiry, or
            roll the token now and then.
          </p>
        </Notice>
      ) : null}

      <details
        className="disclosure"
        open={ipsOpen}
        onToggle={(event) => setIpsOpen(event.currentTarget.open)}
      >
        <summary>
          Limit to IP addresses (optional)
          <Icon name="chevronDown" className="disclosure__chevron" />
        </summary>
        <TextField
          label="Allowed addresses"
          hint="Addresses or networks, separated by commas or spaces, e.g. 203.0.113.7 or 192.168.1.0/24. Requests from anywhere else are refused."
          value={ips}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          error={problems.ips ?? null}
          onChange={(event) => setIps(event.currentTarget.value)}
        />
      </details>

      {generalError === null ? null : (
        <Notice tone="danger" role="alert" title="The token was not created">
          <p>{errorMessage(generalError)}</p>
        </Notice>
      )}
      <div className="dialog__actions">
        <Button onClick={onCancel} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="key" busy={create.isPending}>
          Create token
        </Button>
      </div>
    </form>
  );
}
