import { replace } from "react-router";
import { modePath } from "./insightsLevels";
import { isMode } from "./modeRoute";

/**
 * The When and Roads of before took the mode as `?mode=`; they are now the
 * screens of the mode itself. A known mode leads there (replacing the entry,
 * so Back skips the old address), with the other parameters kept; anything
 * else stays on the screen for every mode.
 */
export function legacyInsightsRedirect(request: Request, part: "time" | "roads") {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  if (mode === null || !isMode(mode)) return null;
  url.searchParams.delete("mode");
  const search = url.searchParams.toString();
  return replace(`${modePath(mode, part)}${search === "" ? "" : `?${search}`}`);
}
