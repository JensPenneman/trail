import type { V1Route } from "../../defineRoute";
import { getDevice } from "./getDevice";
import { getDeviceLocation } from "./getDeviceLocation";
import { listDevices } from "./listDevices";

/** The device operations, in the order of the reference. */
export const deviceRoutes: readonly V1Route[] = [listDevices, getDevice, getDeviceLocation];
