import type { DataAccessResource } from "@trail/contracts/dataAccess";
import type { WorkAccess } from "./runMcpWork";

/**
 * What a tool read of the token's own account, for the data access log: the
 * devices it resolved — `null` when it covered every device the token
 * reaches — and the rest of what it was asked (a range, a day, a mode).
 */
export const ownAccess = (
  devices: readonly { id: string }[] | null,
  rest: DataAccessResource = {},
): WorkAccess => ({
  resource: devices === null ? rest : { ...rest, deviceIds: devices.map((device) => device.id) },
});
