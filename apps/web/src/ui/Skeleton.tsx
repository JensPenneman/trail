import "./Skeleton.css";

interface SkeletonProps {
  /** CSS height, e.g. "6rem". */
  height?: string;
  width?: string;
  rounded?: boolean;
}

/** A placeholder block with the shape of content that is still loading. */
export function Skeleton({ height = "1rem", width = "100%", rounded = false }: SkeletonProps) {
  return (
    <span
      className={rounded ? "skeleton skeleton--round" : "skeleton"}
      style={{ height, width }}
      aria-hidden="true"
    />
  );
}
