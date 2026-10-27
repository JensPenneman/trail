import type { Person } from "@trail/contracts/person";
import type { AccessOwner } from "../dataAccess/accessRecord";

/**
 * What a look at a person shows of them, for their data access log: the
 * devices shown, at the share's precision.
 */
export const personAccess = (person: Person): AccessOwner => ({
  ownerUserId: person.userId,
  shareId: person.share.id,
  resource: {
    deviceIds: person.devices.map((device) => device.id),
    precision: person.share.precision,
  },
});
