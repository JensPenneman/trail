import { useMemo } from "react";
import { encode } from "uqr";
import { qrPath } from "./qrPath";
import "./QrCode.css";

interface QrCodeProps {
  value: string;
  /** What scanning it does, for people who cannot see it. */
  label: string;
}

/** The spec asks scanners for a light quiet zone of 4 modules around the code. */
const quietZone = 4;

/**
 * Always dark modules on a white card, in either colour scheme: inverted codes
 * are not read by every camera app.
 */
export function QrCode({ value, label }: QrCodeProps) {
  const { size, path } = useMemo(() => {
    // Medium error correction survives glare on a laptop screen at a modest size cost.
    const qr = encode(value, { ecc: "M", border: 0 });
    return { size: qr.size + quietZone * 2, path: qrPath(qr.data, quietZone) };
  }, [value]);
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
