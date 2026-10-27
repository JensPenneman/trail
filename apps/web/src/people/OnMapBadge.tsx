import { Icon } from "../ui/Icon";
import "./OnMapBadge.css";

/** On a person's card (or the Me card): the map shows them now. */
export function OnMapBadge() {
  return (
    <p className="on-map-badge">
      <Icon name="pin" />
      <span>On the map</span>
    </p>
  );
}
