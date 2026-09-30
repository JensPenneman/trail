import { deviceStatus } from "@trail/contracts/deviceStatus";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/ApiError";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useConfig } from "../../queries/useConfig";
import { useDevice } from "../../queries/useDevice";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PageHeader } from "../../ui/PageHeader";
import { RelativeTime } from "../../ui/RelativeTime";
import { Skeleton } from "../../ui/Skeleton";
import { StatusBadge } from "../../ui/StatusBadge";
import { AlertsSection } from "./AlertsSection";
import { DeleteDeviceDialog } from "./DeleteDeviceDialog";
import { DeviceOverview } from "./DeviceOverview";
import { IngestLogSection } from "./IngestLogSection";
import { RawPointsSection } from "./RawPointsSection";
import { RemoteSettingsSection } from "./RemoteSettingsSection";
import { RenameDeviceDialog } from "./RenameDeviceDialog";
import { RotateTokenDialog } from "./RotateTokenDialog";
import "./DevicePage.css";

const defaultThresholds = { liveMinutes: 15, staleHours: 12 };

type OpenDialog = "rename" | "rotate" | "delete" | null;

/** One device: its state, what it uploaded, and everything that can be changed about it. */
export function DevicePage() {
  const { deviceId = "" } = useParams();
  const device = useDevice(deviceId);
  const config = useConfig();
  const colors = useDeviceColors();
  const now = useNow(15_000);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const thresholds = config.data?.thresholds ?? defaultThresholds;
  const back = (
    <Link to="/devices" className="device-page__back">
      <Icon name="arrowLeft" />
      Devices
    </Link>
  );

  if (device.data === undefined) {
    const notFound = device.error instanceof ApiError && device.error.status === 404;
    return (
      <div className="page page--narrow">
        <DocumentTitle title={notFound ? "Device not found" : "Device"} />
        <PageHeader title={notFound ? "Device not found" : "Device"} eyebrow={back} />
        {device.isPending ? (
          <LoadingBlock label="Loading the device">
            <Skeleton height="10rem" />
            <Skeleton height="6rem" />
          </LoadingBlock>
        ) : notFound ? (
          <div className="card">
            <EmptyState
              icon="devices"
              title="There is no such device"
              action={<LinkButton to="/devices">All devices</LinkButton>}
            >
              <p>It may have been deleted, or the link belongs to another account.</p>
            </EmptyState>
          </div>
        ) : (
          <ErrorState
            title="The device could not be loaded"
            error={device.error}
            onRetry={() => void device.refetch()}
            retrying={device.isFetching}
          />
        )}
      </div>
    );
  }

  const current = device.data;
  const status = deviceStatus(current.lastSeenAt, new Date(now), thresholds);

  return (
    <div className="page page--narrow device-page">
      <DocumentTitle title={current.name} />
      <PageHeader
        eyebrow={back}
        title={current.name}
        description={
          <span className="device-page__status">
            <DeviceSwatch slot={colors.slot(current.id)} />
            <StatusBadge status={status} thresholds={thresholds} />
            {current.lastSeenAt === null ? (
              <span>No upload yet</span>
            ) : (
              <span>
                Last upload <RelativeTime value={current.lastSeenAt} />
              </span>
            )}
          </span>
        }
        actions={
          <>
            <LinkButton to={`/history?devices=${current.id}`} icon="history">
              History
            </LinkButton>
            <Button icon="pencil" onClick={() => setDialog("rename")}>
              Rename
            </Button>
          </>
        }
      />

      <DeviceOverview device={current} live={status === "live"} />
      <RemoteSettingsSection key={current.pendingSettings ?? "none"} device={current} />
      <AlertsSection device={current} />
      <IngestLogSection deviceId={current.id} />
      <RawPointsSection deviceId={current.id} lastSeenAt={current.lastSeenAt} />

      <section className="section" aria-labelledby="device-danger">
        <h2 className="section__title" id="device-danger">
          Access and removal
        </h2>
        <div className="card device-page__danger">
          <div className="device-page__danger-row">
            <div>
              <p className="device-page__danger-title">New access token</p>
              <p className="muted">
                For a lost token or a phone that changed hands. The current one (…
                {current.tokenHint}) stops working.
              </p>
            </div>
            <Button icon="refresh" onClick={() => setDialog("rotate")}>
              Issue new token
            </Button>
          </div>
          <div className="device-page__danger-row">
            <div>
              <p className="device-page__danger-title">Delete device</p>
              <p className="muted">Removes the device and every point it recorded.</p>
            </div>
            <Button variant="danger-outline" icon="trash" onClick={() => setDialog("delete")}>
              Delete
            </Button>
          </div>
        </div>
      </section>

      <RenameDeviceDialog
        device={current}
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
      />
      <RotateTokenDialog
        device={current}
        open={dialog === "rotate"}
        onClose={() => setDialog(null)}
      />
      <DeleteDeviceDialog
        device={current}
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
