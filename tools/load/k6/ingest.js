/*
 * Uploads as the phones send them, and what each app does when Trail does not
 * acknowledge one (docs/design/capacity.md §3.1): Overland keeps its batch and
 * sends it again at its next interval; OwnTracks for iOS keeps a message on a
 * 5xx and drops it on a 4xx; OwnTracks for Android retries with backoff up to
 * two minutes; Traccar Client keeps its queue; OsmAnd buffers for an hour;
 * GPSLogger drops a point after three failed tries a minute apart. A drop is
 * data loss and counts as such. k6 only.
 */
import { sleep } from "k6";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";
import {
  gpsloggerQuery,
  osmandQuery,
  overlandBatch,
  owntracksLocation,
  owntracksTransition,
  traccarForm,
} from "../lib/encoders.js";
import { positionAlong } from "../lib/routes.js";
import { pointsBetween, stateAt, visitsBetween } from "../lib/schedule.js";
import { batchClass } from "../lib/targets.js";

const metrics = {
  acked: new Counter("ingest_acked"),
  pointsAcked: new Counter("points_acked"),
  pointsDropped: new Counter("points_dropped"),
  pointsUnsent: new Counter("points_unsent"),
  retries: new Counter("ingest_retries"),
  throttled: new Rate("ingest_throttled"),
  failed: new Rate("ingest_failed"),
};

/**
 * A UUID-shaped id of a phone (Overland's `unique_id`), from its device key.
 * @param {string} deviceKey
 */
function uniqueIdOf(deviceKey) {
  let hex = "";
  for (let index = 0; hex.length < 32; index += 1) {
    hex += ((deviceKey.charCodeAt(index % deviceKey.length) * (index + 7)) % 256)
      .toString(16)
      .padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`.toUpperCase();
}

/**
 * The requests of one upload of the schedule (lib/schedule.js `uploadsOf`),
 * one at a time: a backlog of hours builds a body only when it sends it.
 * @param {{ profile: string, token: string, deviceKey: string }} phone
 * @param {import("../lib/schedule.js").PhonePlan} plan
 * @param {import("../lib/schedule.js").UploadRef} upload
 * @param {number} epochS
 */
export function* requestsOf(phone, plan, upload, epochS) {
  const [, , from, to, kind] = upload;
  const { profile } = plan;
  if (kind === 1) {
    const state = stateAt(plan, to);
    const place = positionAlong(plan.route, state ? state.stopAtM : 0);
    yield owntracksTransition(
      phone.token,
      place,
      epochS,
      to,
      from === 1 ? "enter" : "leave",
      phone.deviceKey,
    );
    return;
  }
  const points = pointsBetween(plan, from, to);
  switch (profile.encoder) {
    case "overland": {
      const batchSize = profile.upload.kind === "batch" ? profile.upload.batchSize : 500;
      const visits = visitsBetween(plan, from, to);
      const state = stateAt(plan, to - 1);
      const move = state && state.kind === "moving" ? state.move : null;
      const trip =
        move === null
          ? null
          : {
              mode: move.mode,
              startedAt: move.from,
              distanceM: move.speedMs * (to - move.from),
              start: positionAlong(plan.route, move.startM),
            };
      for (let start = 0; start < points.length; start += batchSize) {
        const last = start + batchSize >= points.length;
        yield overlandBatch(phone.token, points.slice(start, start + batchSize), epochS, {
          deviceKey: phone.deviceKey,
          uniqueId: uniqueIdOf(phone.deviceKey),
          desiredAccuracy: profile.accuracyM.moving <= 10 ? -1 : 100,
          visits: last ? visits : [],
          trip: last ? trip : null,
        });
      }
      return;
    }
    case "owntracks-ios":
      for (const point of points) {
        yield owntracksLocation("ios", phone.token, point, epochS, phone.deviceKey);
      }
      return;
    case "owntracks-android":
      for (const point of points) {
        yield owntracksLocation("android", phone.token, point, epochS, phone.deviceKey);
      }
      return;
    case "traccar":
      for (const point of points) yield traccarForm(phone.token, point, epochS);
      return;
    case "osmand":
      for (const point of points) yield osmandQuery(phone.token, point, epochS);
      return;
    default:
      for (const point of points) yield gpsloggerQuery(phone.token, point, epochS);
  }
}

/**
 * Did Trail acknowledge it, as the app reads the answer?
 * @param {string} app
 * @param {{ status: number, body: string | null }} response
 */
function acknowledged(app, response) {
  if (response.status !== 200) return false;
  if (app !== "overland") return true;
  try {
    return JSON.parse(response.body || "").result === "ok";
  } catch {
    return false;
  }
}

/**
 * How long the app waits before it tries again, or null when it gives up
 * (the points are lost).
 * @param {string} encoder
 * @param {number} status
 * @param {number} attempt the attempts made so far
 * @param {number} waitedS
 * @param {number} intervalS Overland's interval
 */
function retryAfterS(encoder, status, attempt, waitedS, intervalS) {
  switch (encoder) {
    case "overland":
      return intervalS;
    case "owntracks-ios":
      return status >= 400 && status < 500 ? null : Math.min(300, 30 * 2 ** (attempt - 1));
    case "owntracks-android":
      return Math.min(120, 5 * 2 ** (attempt - 1));
    case "traccar":
      return 30;
    case "osmand":
      return waitedS >= 3600 ? null : 30;
    default:
      return attempt >= 3 ? null : 60;
  }
}

/**
 * Sends the requests of some uploads at once, as independent phones would,
 * then tries each unacknowledged one again when its app would (its own wait,
 * not its neighbours'), until the run's end (`deadlineMs`, epoch ms). Tags
 * every request with the phase, its endpoint, app and batch class; `name`
 * stands for the URL, which can hold a token (OsmAnd's address).
 * @param {string} baseUrl
 * @param {string} phase
 * @param {{ app: string, encoder: string, intervalS: number, request: import("../lib/encoders.js").IngestRequest }[]} items
 * @param {number} deadlineMs
 */
export function sendUploads(baseUrl, phase, items, deadlineMs) {
  let queue = items.map((item) => ({ ...item, attempts: 0, waitedS: 0, dueAt: 0 }));
  while (queue.length > 0) {
    const now = Date.now();
    const due = queue.filter((item) => item.dueAt <= now);
    const later = queue.filter((item) => item.dueAt > now);
    if (due.length === 0) {
      sleep((Math.min(...later.map((item) => item.dueAt)) - now) / 1000);
      continue;
    }
    const responses = http.batch(
      due.map(({ app, request }) => {
        const endpoint = request.path.slice(5).split("?")[0];
        return {
          method: request.method,
          url: `${baseUrl}${request.path}`,
          body: request.body,
          params: {
            headers: request.headers,
            responseCallback: http.expectedStatuses(200),
            tags: {
              name: endpoint,
              phase,
              kind: "ingest",
              endpoint,
              app,
              batch: batchClass(request.points),
            },
            timeout: "60s",
          },
        };
      }),
    );
    const again = [];
    for (let index = 0; index < due.length; index += 1) {
      const item = due[index];
      const response = responses[index];
      item.attempts += 1;
      const ok = acknowledged(item.app, response);
      const throttled = response.status === 429 || response.status === 503;
      metrics.throttled.add(throttled, { phase });
      metrics.failed.add(!ok && !throttled, { phase });
      if (ok) {
        metrics.acked.add(1, { phase });
        metrics.pointsAcked.add(item.request.points, { phase });
        continue;
      }
      const wait = retryAfterS(
        item.encoder,
        response.status,
        item.attempts,
        item.waitedS,
        item.intervalS,
      );
      if (wait === null) {
        metrics.pointsDropped.add(item.request.points, { phase, app: item.app });
        continue;
      }
      if (Date.now() + wait * 1000 > deadlineMs) {
        metrics.pointsUnsent.add(item.request.points, { phase });
        continue;
      }
      metrics.retries.add(1, { phase });
      item.waitedS += wait;
      item.dueAt = Date.now() + wait * 1000;
      again.push(item);
    }
    queue = [...later, ...again];
  }
}
