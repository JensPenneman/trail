import { ActivitySparkline } from "../../devices/ActivitySparkline";
import { activitySlots } from "../../devices/activitySlots";
import { useActivity } from "../../queries/useActivity";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";

const hours = 48;
/** Every device's hours, as Settings › Devices asks for them: one cached answer for both pages. */
const lastTwoDays = { hours, deviceIds: null };

interface ActivitySectionProps {
  deviceId: string;
  deviceName: string;
  colorSlot: number;
}

/** Points recorded and uploads per hour over the last two days: whether data keeps coming. */
export function ActivitySection({ deviceId, deviceName, colorSlot }: ActivitySectionProps) {
  const activity = useActivity(lastTwoDays);
  return (
    <SettingsGroup
      title="Activity"
      variant="card"
      footer="Points and uploads per hour, the last 48 hours."
    >
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
        <ActivitySparkline
          slots={activitySlots(activity.data.buckets, deviceId, activity.data.to, hours)}
          colorSlot={colorSlot}
          deviceName={deviceName}
        />
      )}
    </SettingsGroup>
  );
}
