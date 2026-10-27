import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionLabel, lookKindOf } from "../src/accessLog/accessActions";
import {
  actorDetail,
  groupByDay,
  howOftenText,
  isFolded,
  lineFacts,
  whenText,
} from "../src/accessLog/accessLineText";
import {
  accessLogParams,
  isFiltered,
  parseAccessLogSearch,
  shownSearch,
  withAccessLogFilter,
} from "../src/accessLog/accessLogSearch";
import { actorIdOfSegment, actorSegment, viewerPath } from "../src/accessLog/actorAddress";
import { noNames, resourceFacts } from "../src/accessLog/resourceFacts";
import { othersLooked, viewerCount } from "../src/accessLog/summaryFacts";
import { parseViewerDays, periodStart } from "../src/accessLog/viewerDays";
import {
  linkSentence,
  timesText,
  tokenSentence,
  viewerSentence,
} from "../src/accessLog/viewerSentence";
import { createFormatter } from "../src/format/createFormatter";
import { topViewerText } from "../src/pages/insights/WhoViewedYouCard";
import { settingsBadgeValue } from "../src/settings/settingsBadges";
import { accessLine, busySummary, emptySummary } from "./support/accessLogFixtures";
import { ids, user } from "./support/fixtures";

const format = createFormatter("en-GB", "Europe/Brussels");
// Tuesday 27 October 2026, 15:00 in Brussels.
const now = Date.parse("2026-10-27T14:00:00.000Z");

describe("actor ids in an address", () => {
  it("travel in an address as one opaque segment", () => {
    const ids_ = [`person:${ids.ana}`, "session:Safari on iPhone", "session:Ünïcødé / 東京"];
    for (const id of ids_) {
      const segment = actorSegment(id);
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(actorIdOfSegment(segment)).toBe(id);
    }
    expect(viewerPath(`person:${ids.ana}`)).toBe(
      `/settings/privacy/viewers/${actorSegment(`person:${ids.ana}`)}`,
    );
    // Written the one way, whatever the case of the UUID inside.
    expect(actorIdOfSegment(actorSegment(`link:${ids.link.toUpperCase()}`))).toBe(
      `link:${ids.link}`,
    );
  });

  it("make nothing of a segment that is not an actor's", () => {
    for (const segment of [
      "",
      "not base64!",
      "a",
      actorSegment("admin:root"),
      actorSegment(ids.ana),
      // Not UTF-8 once decoded.
      "_w",
    ]) {
      expect(actorIdOfSegment(segment), segment).toBeNull();
    }
  });
});

describe("the sentences of Who viewed you", () => {
  it("say what a person looked at, how often and when last", () => {
    const [ana] = busySummary(30, now).people;
    if (ana === undefined) throw new Error("no Ana");
    expect(
      viewerSentence(
        { ...ana, actions: ana.actions.slice(1), lastAt: "2026-10-27T13:03:00.000Z" },
        format,
        now,
      ),
    ).toBe(
      "Ana Bell looked at your live position 14 times and your history twice, last today at 14:03.",
    );
    expect(viewerSentence({ ...ana, lastAt: "2026-10-26T17:03:00.000Z" }, format, now)).toBe(
      "Ana Bell looked at your live position 14 times and your history twice, and received 30 live updates, last yesterday at 18:03.",
    );
    expect(
      viewerSentence(
        {
          ...ana,
          actions: [{ action: "getPersonTrack", count: 1 }],
          lastAt: "2026-10-20T17:03:00.000Z",
        },
        format,
        now,
      ),
    ).toBe("Ana Bell looked at your history once, last on 20 October at 19:03.");
    expect(
      viewerSentence(
        {
          ...ana,
          actions: [
            { action: "listPeople", count: 1 },
            { action: "getPerson", count: 1 },
          ],
          lastAt: "2026-10-24T08:00:00.000Z",
        },
        format,
        now,
      ),
    ).toBe("Ana Bell looked at your live position twice, last on Saturday at 10:00.");
  });

  it("count live updates on their own, and name someone without a name", () => {
    expect(
      viewerSentence(
        {
          userId: ids.ana,
          displayName: " ",
          events: 1,
          lastAt: "2026-10-27T13:03:00.000Z",
          actions: [{ action: "live.position", count: 1 }],
        },
        format,
        now,
      ),
    ).toBe("Someone received 1 live update of your position, last today at 14:03.");
    expect(
      viewerSentence(
        {
          userId: ids.ana,
          displayName: "Ana",
          events: 3,
          lastAt: "2026-10-27T13:03:00.000Z",
          actions: [{ action: "getSomethingNew", count: 3 }],
        },
        format,
        now,
      ),
    ).toBe("Ana looked at other data 3 times, last today at 14:03.");
  });

  it("pluralise", () => {
    expect([1, 2, 3, 1200].map((count) => timesText(count, format))).toEqual([
      "once",
      "twice",
      "3 times",
      "1,200 times",
    ]);
    const summary = busySummary(30, now);
    const [link] = summary.links;
    const [token] = summary.tokens;
    if (link === undefined || token === undefined) throw new Error("no link or token");
    expect(linkSentence({ ...link, lastAt: "2026-10-27T13:40:00.000Z" }, format, now)).toBe(
      "Opened 3 times by 2 visitors, last today at 14:40.",
    );
    expect(
      linkSentence(
        { ...link, events: 1, visitors: 1, lastAt: "2026-10-27T13:40:00.000Z" },
        format,
        now,
      ),
    ).toBe("Opened once by 1 visitor, last today at 14:40.");
    expect(tokenSentence({ ...token, lastAt: "2026-10-27T13:30:00.000Z" }, format, now)).toBe(
      "Used 14 times: 10 API calls and 4 through MCP, last today at 14:30.",
    );
    expect(
      tokenSentence(
        { ...token, events: 1, api: 1, mcp: 0, lastAt: "2026-10-27T13:30:00.000Z" },
        format,
        now,
      ),
    ).toBe("Used once, last today at 14:30.");
  });

  it("know which actions are looks at you", () => {
    expect(
      ["listPeople", "getPerson", "getPersonTrack", "live.position", "getTracks"].map(lookKindOf),
    ).toEqual(["position", "position", "history", "live", "other"]);
    expect(actionLabel("getPersonTrack", "people")).toBe("Your history");
    expect(actionLabel("getPersonTrack", "api")).toBe("The history of someone who shares with you");
    expect(actionLabel("mcp.get_timeline", "mcp")).toBe("Timeline");
    expect(actionLabel("somethingNew", "api")).toBe("somethingNew");
  });
});

describe("the access log's filters", () => {
  const context = { showOwn: false, today: "2026-10-27", timeZone: "Europe/Brussels" };

  it("are the address, and leave out what they do not understand", () => {
    expect(
      parseAccessLogSearch(
        new URLSearchParams("actor=person&channel=people&days=7&action=getPersonTrack"),
      ),
    ).toEqual({ actor: "person", channel: "people", days: 7, action: "getPersonTrack" });
    expect(
      parseAccessLogSearch(
        new URLSearchParams("actor=admin&channel=email&days=5&action=DROP TABLE"),
      ),
    ).toEqual({ actor: null, channel: null, days: null, action: null });
    const next = withAccessLogFilter(new URLSearchParams("actor=person&view=x"), {
      actor: null,
      days: 30,
    });
    expect(next.toString()).toBe("view=x&days=30");
    expect(isFiltered(parseAccessLogSearch(next))).toBe(true);
    expect(isFiltered(parseAccessLogSearch(new URLSearchParams()))).toBe(false);
  });

  it("leave your own activity out unless it is shown", () => {
    const everyone = parseAccessLogSearch(new URLSearchParams());
    expect(accessLogParams(everyone, context)).toEqual({
      actor: ["person", "link", "token"],
      channel: null,
      action: null,
      from: null,
      actorId: null,
    });
    expect(accessLogParams(everyone, { ...context, showOwn: true }).actor).toBeNull();
    // Asking for yourself while you are hidden asks for everyone else.
    const yourself = parseAccessLogSearch(new URLSearchParams("actor=owner&channel=web"));
    expect(shownSearch(yourself, false)).toMatchObject({ actor: null, channel: null });
    expect(accessLogParams(yourself, context)).toMatchObject({
      actor: ["person", "link", "token"],
      channel: null,
    });
    expect(accessLogParams(yourself, { ...context, showOwn: true })).toMatchObject({
      actor: ["owner"],
      channel: ["web"],
    });
  });

  it("start a period at the beginning of its first local day", () => {
    const search = parseAccessLogSearch(new URLSearchParams("days=7&actor=link"));
    // 21 October in Brussels, still summer time (UTC+2).
    expect(accessLogParams(search, context)).toMatchObject({
      actor: ["link"],
      from: "2026-10-20T22:00:00.000Z",
    });
    expect(accessLogParams(parseAccessLogSearch(new URLSearchParams("days=1")), context).from).toBe(
      "2026-10-26T23:00:00.000Z",
    );
  });

  it("start with the first hour of the first day, also half an hour off UTC", () => {
    expect(periodStart("2026-10-27", 1, "Europe/Brussels")).toBe("2026-10-26T23:00:00.000Z");
    // Midnight in Kolkata is 18:30 UTC: the hour from 18:00 starts the day before there.
    expect(periodStart("2026-10-27", 1, "Asia/Kolkata")).toBe("2026-10-26T19:00:00.000Z");
    expect(periodStart("2026-10-27", 7, "Asia/Kolkata")).toBe("2026-10-20T19:00:00.000Z");
  });

  it("of Who viewed you are 7, 30 or 90 days", () => {
    expect(parseViewerDays(new URLSearchParams("days=7"))).toBe(7);
    expect(parseViewerDays(new URLSearchParams("days=90"))).toBe(90);
    expect(parseViewerDays(new URLSearchParams("days=12"))).toBe(30);
    expect(parseViewerDays(new URLSearchParams())).toBe(30);
  });
});

describe("the lines of the log", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("group by local day, the last access first within an hour, across pages", () => {
    const hour = 3_600_000;
    const at = (ms: number) => new Date(ms).toISOString();
    const thisHour = Math.floor(now / hour) * hour;
    const early = accessLine({ lastAt: at(thisHour + 5 * 60_000) }, 0, now);
    const late = accessLine({ lastAt: at(thisHour + 50 * 60_000) }, 0, now);
    const earlier = accessLine({}, 3 * hour, now);
    // Before midnight in Brussels (23:00 UTC the day before).
    const yesterday = accessLine({}, 16 * hour, now);
    // The pages as the server sends them: by hour, within one by dedupe key.
    const firstPage = [early, late];
    const secondPage = [earlier, yesterday];
    const days = groupByDay([...firstPage, ...secondPage], "Europe/Brussels");
    expect(days.map((day) => day.date)).toEqual(["2026-10-27", "2026-10-26"]);
    expect(days[0]?.lines.map((line) => line.id)).toEqual([late.id, early.id, earlier.id]);
    expect(days[1]?.lines.map((line) => line.id)).toEqual([yesterday.id]);
  });

  it("say when, how often, and fold what is not listed one by one", () => {
    const line = accessLine({}, 0, now);
    expect(whenText(line, format)).toMatch(/^\d{2}:03–\d{2}:41$/);
    expect(howOftenText(line, format)).toBe("twice");
    const folded = accessLine({ count: 37, resource: { deviceIds: [ids.phone], folded: true } });
    expect(isFolded(folded)).toBe(true);
    expect(howOftenText(folded, format)).toBe("… and 37 more");
    const others = accessLine({
      actorKind: "link",
      channel: "link",
      action: "link.view",
      actor: { kind: "link", linkId: ids.link, linkLabel: "Home", visitor: null },
      count: 12,
      resource: { precision: "area" },
    });
    expect(isFolded(others)).toBe(true);
    expect(actorDetail(others.actor)).toBe("Other visitors, counted together");
  });

  it("open to everything they say, with the names of what they name", () => {
    const names = {
      ...noNames,
      devices: new Map([[ids.phone, "iPhone 16"]]),
      shares: new Map([[ids.myShare, "Ana Bell"]]),
    };
    const facts = Object.fromEntries(
      lineFacts(
        accessLine({
          resource: {
            deviceIds: [ids.phone, ids.car],
            level: "inferred",
            from: "2026-10-20",
            to: "2026-10-26",
            shareId: ids.myShare,
          },
        }),
        names,
        format,
      ).map((fact) => [fact.label, fact.value]),
    );
    expect(facts).toMatchObject({
      Who: "Ana Bell · Someone you share with",
      Through: "People",
      What: "Your history (getPersonTrack)",
      Kind: "Read",
      "How often": "twice",
      Devices: "iPhone 16 and a deleted device",
      Period: "20 Oct 2026 to 26 Oct 2026",
      Level: "Transport",
      Share: "Ana Bell",
      Answer: "200 OK",
    });
    // Before the lists have come, nothing is called deleted.
    expect(
      resourceFacts(
        { deviceIds: [ids.phone, ids.car], shareId: ids.myShare, tokenId: ids.token },
        noNames,
        format,
      ),
    ).toEqual([
      { label: "Devices", value: "2 devices" },
      { label: "Share", value: "A share" },
      { label: "API token", value: "An API token" },
    ]);
    expect(
      resourceFacts({ mode: null, format: "gpx", historyDays: null, hours: 1 }, noNames, format),
    ).toEqual([
      { label: "Hours", value: "The last 1 hour" },
      { label: "Mode", value: "Taken back" },
      { label: "Format", value: "GPX" },
      { label: "History", value: "Live only" },
    ]);
  });
});

describe("the summary on other pages", () => {
  it("is a count on the row of Who viewed you, and nothing while nobody looked", () => {
    const sources = { user, now, count: format.count };
    expect(settingsBadgeValue("viewers", { ...sources, viewers: busySummary(30, now) })).toBe("3");
    expect(
      settingsBadgeValue("viewers", { ...sources, viewers: emptySummary(30, now) }),
    ).toBeNull();
    expect(settingsBadgeValue("viewers", sources)).toBeNull();
    expect(viewerCount(busySummary(30, now))).toBe(3);
  });

  it("tells whether anyone but you looked, and who most", () => {
    const busy = busySummary(30, now);
    expect(othersLooked(busy)).toBe(true);
    expect(othersLooked({ ...emptySummary(30, now), own: busy.own })).toBe(false);
    expect(topViewerText(busy, format)).toBe("Ana Bell looked most often: 46 times.");
    expect(topViewerText({ ...busy, people: [] }, format)).toBe(
      "Your token “Home Assistant” was used most often: 14 times.",
    );
    expect(topViewerText(emptySummary(30, now), format)).toBeNull();
  });
});
