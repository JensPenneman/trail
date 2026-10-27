import { useId } from "react";
import { ActivitySparkline } from "../../devices/ActivitySparkline";
import { activitySlots } from "../../devices/activitySlots";
import { useActivity } from "../../queries/useActivity";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";

const hours = 48;
/** Every device's hours, as the Devices page asks for them: one cached answer for both pages. */
const lastTwoDays = { hours, deviceIds: null };

interface ActivitySectionProps {
  deviceId: string;
  deviceName: string;
  colorSlot: number;
}

/** Points recorded and uploads per hour over the last two days: whether data keeps coming. */
export function ActivitySection({ deviceId, deviceName, colorSlot }: ActivitySectionProps) {
  const headingId = useId();
  const activity = useActivity(lastTwoDays);
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Activity
        </h2>
        <p className="section__description">Points and uploads per hour, the last 48 hours.</p>
      </div>
      {activity.isPending ? (
        <LoadingBlock label="Loading the activity">
          <Skeleton height="5rem" />
        </LoadingBlock>
      ) : activity.isError ? (
        <ErrorState
          title="The activity could not be loaded"
          error={activity.error}
          onRetry={() => void activity.refetch()}
          retrying={activity.isFetching}
        />
      ) : (
        <div className="card">
          <ActivitySparkline
            slots={activitySlots(activity.data.buckets, deviceId, activity.data.to, hours)}
            colorSlot={colorSlot}
            deviceName={deviceName}
          />
        </div>
      )}
    </section>
  );
}
