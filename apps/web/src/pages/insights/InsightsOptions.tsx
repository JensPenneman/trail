import { useId, useState } from "react";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useDevices } from "../../queries/useDevices";
import { DisclosureButton } from "../../ui/DisclosureButton";
import { DisclosureContent } from "../../ui/DisclosureContent";
import { Icon } from "../../ui/Icon";
import { useDisclosure } from "../../ui/useDisclosure";
import { DeviceFilter } from "../map/DeviceFilter";
import { InsightsPopover } from "./InsightsPopover";
import type { InsightsPeriodState } from "./useInsightsPeriod";

/**
 * The options of the numbers: which devices count, under "Advanced". With a
 * single device there is nothing to choose, so there is no button either.
 */
export function InsightsOptions({ state }: { state: InsightsPeriodState }) {
  const devices = useDevices();
  const colors = useDeviceColors();
  const popoverId = useId();
  // A filter that is on is not to be hidden: the choice opens at once.
  const advanced = useDisclosure(state.devices !== null);
  const [open, setOpen] = useState(false);
  const own = devices.data ?? [];
  if (own.length < 2) return null;
  // Devices the person no longer has are dropped, like the People page does.
  const selected =
    state.devices === null
      ? null
      : state.devices.filter((id) => own.some((device) => device.id === id));
  const counted = selected === null || selected.length === 0 ? null : selected;
  return (
    <InsightsPopover
      open={open}
      onOpenChange={setOpen}
      popoverId={popoverId}
      button={(props) => (
        <button type="button" className="insights-bar__options" {...props}>
          <Icon name="settings" />
          <span>Options</span>
          {counted === null ? null : (
            <>
              {" "}
              <span className="insights-bar__note">{`${counted.length} of ${own.length} devices`}</span>
            </>
          )}
        </button>
      )}
    >
      {() => (
        <>
          <DisclosureButton disclosure={advanced}>Advanced</DisclosureButton>
          <DisclosureContent disclosure={advanced}>
            <DeviceFilter
              groups={[
                {
                  key: "me",
                  name: "Me",
                  devices: own.map((device) => ({
                    id: device.id,
                    name: device.name,
                    slot: colors.slot(device.id),
                    palette: "device" as const,
                  })),
                },
              ]}
              selected={counted}
              onChange={state.chooseDevices}
            />
          </DisclosureContent>
        </>
      )}
    </InsightsPopover>
  );
}
