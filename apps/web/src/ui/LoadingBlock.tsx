import type { ReactNode } from "react";
import "./LoadingBlock.css";

interface LoadingBlockProps {
  /** Read to screen readers instead of the placeholder shapes. */
  label: string;
  children: ReactNode;
}

/** Wraps skeleton shapes so assistive technology hears one "Loading …" instead of nothing. */
export function LoadingBlock({ label, children }: LoadingBlockProps) {
  return (
    <div className="loading-block" aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}
