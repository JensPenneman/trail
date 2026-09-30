import "./Spinner.css";

interface SpinnerProps {
  /** Announced to screen readers; omit when the surrounding text already says what is loading. */
  label?: string;
  size?: "s" | "m" | "l";
}

export function Spinner({ label, size = "m" }: SpinnerProps) {
  return (
    <span
      className={`spinner spinner--${size}`}
      {...(label === undefined ? { "aria-hidden": true } : { role: "status", "aria-label": label })}
    />
  );
}
