import { TrailMark } from "./TrailMark";
import "./Wordmark.css";

interface WordmarkProps {
  size?: "m" | "l";
}

/** Mark plus name. The name is real text, so the logo reads as "Trail" to assistive technology. */
export function Wordmark({ size = "m" }: WordmarkProps) {
  return (
    <span className={`wordmark wordmark--${size}`}>
      <TrailMark size={size === "l" ? 40 : 28} />
      <span className="wordmark__name">Trail</span>
    </span>
  );
}
