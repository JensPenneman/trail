import { Spinner } from "../ui/Spinner";
import { TrailMark } from "../ui/TrailMark";
import "./AppLoading.css";

/** Shown while the first screen's code or the session check is still on its way. */
export function AppLoading() {
  return (
    <div className="app-loading">
      <TrailMark size={48} />
      <Spinner label="Loading Trail" />
    </div>
  );
}
