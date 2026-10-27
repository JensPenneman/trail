import { getPeopleInputSchema, getPeopleOutputSchema } from "@trail/contracts/mcp";
import { loadPeople } from "../../sharing/loadPeople";
import { personAccess } from "../../sharing/personAccess";
import { defineTool } from "../defineTool";
import { quoted } from "../deviceRef";
import { presentBattery } from "../presentBattery";
import { safeText } from "../safeText";
import { kmh, oneDecimal, secondsBetween } from "../units";
import { formatInZone } from "../zonedTime";

/**
 * `get_people` — the people who share with the owner, through the sharing
 * rules only (`loadPeople`: `resolveAccessibleDevices` and `toSharedDevice`),
 * so positions come at the precision each person chose, battery and mode
 * only where they share details, and the distance only for a token that may
 * read the owner's own positions. Their addresses and account and device ids
 * stay out: an agent needs none of them. Like the People page, looking
 * stamps the shares' last view and counts in each person's data access log,
 * which their owners see.
 */
export const getPeople = defineTool({
  name: "get_people",
  title: "Get the people who share with you",
  description:
    "The people who share their location with the owner, as each chose to share it: name, how precisely and until when, and per shared device its newest position — for approximate and area shares the centre of a cell, never where the person is — how old it is, and, only where they share details, battery and how the device travels now. `distanceM` is from the owner's own newest position. Never try to work out a more precise position than given.",
  scopes: ["people:read"],
  input: getPeopleInputSchema,
  output: getPeopleOutputSchema,
  access: "read",
  transaction: false,
  async run(_input, context) {
    const { timeZone, now } = context;
    const shown = await loadPeople(context.ctx, context.principal);
    const people = shown.map((person) => ({
      name: safeText(person.displayName),
      precision: person.share.precision,
      sharedUntil:
        person.share.expiresAt === null
          ? null
          : formatInZone(new Date(person.share.expiresAt), timeZone),
      devices: person.devices.map((device) => ({
        name: safeText(device.name),
        location:
          device.location === null
            ? null
            : {
                lat: device.location.lat,
                lon: device.location.lon,
                accuracyM: oneDecimal(device.location.accuracy),
                recordedAt: formatInZone(new Date(device.location.recordedAt), timeZone),
                ageS: Math.max(0, secondsBetween(new Date(device.location.recordedAt), now)),
                speedKmh: kmh(device.location.speed),
              },
        battery: presentBattery(device.battery, timeZone),
        currentMode: device.activity?.mode ?? null,
        distanceM: device.distanceM,
      })),
    }));
    const names = people.map((person) => `${quoted(person.name)} (${person.precision})`);
    return {
      result: { people },
      text:
        people.length === 0
          ? "Nobody shares their location with the owner."
          : `${people.length} ${people.length === 1 ? "person shares" : "people share"} with the owner: ${names.join(", ")}.`,
      items: people.length,
      access: { owners: shown.map(personAccess) },
    };
  },
});
