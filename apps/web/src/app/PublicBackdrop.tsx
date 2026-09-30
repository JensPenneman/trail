import "./PublicBackdrop.css";

/** Decoration for the signed-out pages: a faint grid and a long dotted trail across it. */
export function PublicBackdrop() {
  return (
    <div className="public-backdrop" aria-hidden="true">
      <svg
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className="public-backdrop__trail"
          d="M-40 690c150-10 210-120 330-150s190 60 300 20 120-190 250-230 170 40 260 0 120-150 180-190"
        />
        <path
          className="public-backdrop__trail public-backdrop__trail--faint"
          d="M-40 180c120 40 170 150 290 150s160-110 280-100 150 150 270 160 190-90 300-60 90 120 140 160"
        />
        <circle className="public-backdrop__halo" cx="1160" cy="-10" r="26" />
      </svg>
    </div>
  );
}
