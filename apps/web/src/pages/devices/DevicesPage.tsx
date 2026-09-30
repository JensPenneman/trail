import { deviceStatus } from "@trail/contracts/deviceStatus";
import { useId } from "react";
import { useSearchParams } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useConfig } from "../../queries/useConfig";
import { useDevices } from "../../queries/useDevices";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PageHeader } from "../../ui/PageHeader";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { AddDeviceDialog } from "./AddDeviceDialog";
import { DeviceRow } from "./DeviceRow";
import "./DevicesPage.css";

const defaultThresholds = { liveMinutes: 15, staleHours: 12 };

/** Every phone of the signed-in person, and the way to add one (`?add=1` opens the dialog). */
export function DevicesPage() {
  const [params, setParams] = useSearchParams();
  const howId = useId();
  const devices = useDevices();
  const config = useConfig();
  const colors = useDeviceColors();
  const now = useNow(15_000);
  const thresholds = config.data?.thresholds ?? defaultThresholds;
  const adding = params.get("add") === "1";
  const setAdding = (open: boolean) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (open) next.set("add", "1");
        else next.delete("add");
        return next;
      },
      { replace: true },
    );

  return (
    <div className="page">
      <DocumentTitle title="Devices" />
      <PageHeader
        title="Devices"
        description="Phones that send their location to Trail with Overland."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add device
          </Button>
        }
      />

      {devices.isPending ? (
        <LoadingBlock label="Loading devices">
          <Skeleton height="4.5rem" />
          <Skeleton height="4.5rem" />
        </LoadingBlock>
      ) : devices.isError ? (
        <ErrorState
          title="Devices could not be loaded"
          error={devices.error}
          onRetry={() => void devices.refetch()}
          retrying={devices.isFetching}
        />
      ) : devices.data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="devices"
            title="No devices yet"
            action={
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                Add your first device
              </Button>
            }
          >
            <p>Each phone gets its own access token, so you can see and manage them separately.</p>
          </EmptyState>
        </div>
      ) : (
        <PlainList className="card card--flush devices-page__list">
          {devices.data.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              status={deviceStatus(device.lastSeenAt, new Date(now), thresholds)}
              thresholds={thresholds}
              colorSlot={colors.slot(device.id)}
            />
          ))}
        </PlainList>
      )}

      <section className="section devices-page__how" aria-labelledby={howId}>
        <h2 className="section__title" id={howId}>
          How it works
        </h2>
        <ol className="devices-page__steps">
          <li>
            Install <strong>Overland</strong> (free, open source) from the App Store on the iPhone.
          </li>
          <li>Add a device here and scan the code it shows with the iPhone’s camera.</li>
          <li>
            Overland sends its points in batches; each upload appears on Live within seconds, and
            the phone keeps anything it could not send until the next try.
          </li>
        </ol>
      </section>

      <AddDeviceDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
