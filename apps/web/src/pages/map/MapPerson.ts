/** Someone whose data the map can show: the signed-in person, or someone sharing with them. */
export interface MapPerson {
  /** `me`, or the person's user id. */
  key: string;
  name: string;
  /** Their devices on the map, in the order the device filter lists them. */
  devices: readonly { id: string; name: string }[];
}
