import type { ReactNode } from "react";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useDevices } from "../../queries/useDevices";
import { DeviceFilter } from "../map/DeviceFilter";
import { PeriodPicker } from "./PeriodPicker";
import type { InsightsSearchState } from "./useInsightsSearch";
import "./InsightsFilters.css";

interface InsightsFiltersProps {
  state: InsightsSearchState;
  /** A filter of the page's own (the mode), after the period and the devices. */
  extra?: ReactNode;
}

/**
 * One row of filters above everything they scope: the period, the devices
 * (when there is more than one) and the page's own. Every chart and number
 * below follows them.
 */
export function InsightsFilters({ state, extra }: InsightsFiltersProps) {
  const devices = useDevices();
  const colors = useDeviceColors();
  const { search } = state;
  const own = devices.data ?? [];
  // Devices the person no longer has are dropped, like the People page does.
  const selected =
    search.devices === null
      ? null
      : search.devices.filter((id) => own.some((device) => device.id === id));
  return (
    <section className="insights-filters" aria-label="Filters">
      <PeriodPicker
        key={`${search.period}:${search.from ?? ""}:${search.to ?? ""}`}
        search={search}
        range={state.range}
        today={state.today}
        onPeriod={(period) => state.choosePeriod({ period })}
        onRange={(from, to) => state.choosePeriod({ from, to })}
      />
      {own.length > 1 ? (
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
          selected={selected === null || selected.length === 0 ? null : selected}
          onChange={state.chooseDevices}
        />
      ) : null}
      {extra}
    </section>
  );
}
