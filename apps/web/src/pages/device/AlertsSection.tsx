import type { DeviceSummary } from "@trail/contracts/device";
import { useId } from "react";
import { useConfig } from "../../queries/useConfig";
import { useUpdateDevice } from "../../queries/useUpdateDevice";
import { ErrorState } from "../../ui/ErrorState";
import { Switch } from "../../ui/Switch";

interface AlertsSectionProps {
  device: DeviceSummary;
}

/** The "this phone went silent" notification (ntfy), per device. */
export function AlertsSection({ device }: AlertsSectionProps) {
  const headingId = useId();
  const config = useConfig();
  const update = useUpdateDevice(device.id);
  const staleHours = config.data?.thresholds.staleHours ?? 12;
  const available = config.data?.features.alerts === true;
  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Alerts
      </h2>
      <div className="card">
        <Switch
          label="Tell me when this device goes silent"
          description={
            available
              ? `A notification after ${staleHours} hours without an upload, and another one when data arrives again.`
              : "This server has no notification channel configured (ALERT_NTFY_URL), so no alerts are sent."
          }
          checked={device.alertsEnabled}
          disabled={!available}
          busy={update.isPending}
          onChange={(alertsEnabled) => update.mutate({ alertsEnabled })}
        />
        {update.isError ? (
          <ErrorState title="The setting was not saved" error={update.error} />
        ) : null}
      </div>
    </section>
  );
}
