import { ana, bob, ids, tracks } from "./fixtures";
import { standardRoutes } from "./standardRoutes";

/** Ana shares precisely with seven days of history; bob approximately, live only. */
export const anaWithHistory = () => ana({ share: { ...ana().share, historyDays: 7 } });
export const trackOfAna = ({ url }: { url: URL }) => {
  const answer = tracks(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "");
  return {
    status: 200,
    body: {
      ...answer,
      tracks: answer.tracks.map((track) => ({ ...track, deviceId: ids.anaPhone })),
    },
  };
};
export const withHistoryOfAna = () => ({
  ...standardRoutes(),
  "GET /api/v1/people": { status: 200, body: { people: [anaWithHistory(), bob()] } },
  [`GET /api/v1/people/${ids.ana}/track`]: trackOfAna,
});
