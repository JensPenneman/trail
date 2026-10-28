import { useParams } from "react-router";
import { useDevice } from "../../queries/useDevice";

/** The device a page of Settings › Devices is about: the one its address names. */
export function useRoutedDevice() {
  const { deviceId = "" } = useParams();
  return { deviceId, device: useDevice(deviceId) };
}
