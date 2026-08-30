import { useId } from 'react';

/**
 * A glass bottle, drawn as inline SVG.
 *
 * Inline rather than an image file because the glass has to pick up the colour
 * of whatever sky it is floating under, and because the cork needs to be its
 * own element so it can be lifted out.
 *
 * When it is something you can act on it is a real <button>, so it is reachable
 * by keyboard and announced as a control. When it is only scenery it is a plain
 * element with no role at all.
 */
export default function Bottle({
  open = false,
  onOpen,
  label,
  small = false,
  halo = false,
  paper = true,
}) {
  const art = <BottleArt open={open} small={small} paper={paper} />;

  const bottle = onOpen ? (
    <button
      type="button"
      className="bottle"
      data-open={open ? 'true' : 'false'}
      onClick={onOpen}
    >
      <span className="visually-hidden">{label}</span>
      {art}
    </button>
  ) : (
    <div className="bottle" data-open={open ? 'true' : 'false'}>
      {art}
    </div>
  );

  if (!halo) return bottle;

  return (
    <span className="bottle-stack">
      <span className="bottle-halo" aria-hidden="true" />
      {bottle}
    </span>
  );
}

function BottleArt({ open, small, paper }) {
  const id = useId();
  const glass = `${id}-glass`;
  const shine = `${id}-shine`;
  const cork = `${id}-cork`;
  const inside = `${id}-inside`;
  const clip = `${id}-clip`;

  return (
    <svg
      className={small ? 'bottle-art bottle-art--small' : 'bottle-art'}
      viewBox="0 0 120 300"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={glass} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="var(--glass-rim)" stopOpacity="0.5" />
          <stop offset="38%" stopColor="var(--glass)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--sea-near)" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={inside} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sea-far)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--sea-near)" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--light-core)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--light-core)" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id={cork} x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0%" stopColor="var(--cork)" />
          <stop offset="70%" stopColor="var(--cork-dark)" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* The glass itself. */}
      <path d={BODY} fill={`url(#${glass})`} />
      <g clipPath={`url(#${clip})`}>
        <path d={BODY} fill={`url(#${inside})`} />
        {/* A little sea water that came along for the ride. */}
        <path d="M 14 250 Q 60 240 106 250 L 106 296 L 14 296 Z" fill="var(--sea-mid)" opacity="0.55" />
        {paper ? <RolledPaper open={open} /> : null}
      </g>

      {/* Rim highlights: two strokes are the whole trick to making glass read. */}
      <path d={BODY} fill="none" stroke="var(--glass-rim)" strokeOpacity="0.55" strokeWidth="2" />
      <path
        d="M 40 116 C 34 132, 30 142, 30 158 L 30 254"
        fill="none"
        stroke={`url(#${shine})`}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M 88 150 L 88 240"
        fill="none"
        stroke="var(--glass-rim)"
        strokeOpacity="0.3"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Neck lip, then the cork on its own group so it can leave. */}
      <path
        d="M 46 52 L 74 52 L 74 62 L 46 62 Z"
        fill="var(--glass-rim)"
        fillOpacity="0.4"
      />
      <g className="cork">
        <rect x="47" y="24" width="26" height="36" rx="5" fill={`url(#${cork})`} />
        <ellipse cx="60" cy="25" rx="13" ry="4" fill="var(--cork)" />
        <path d="M 53 30 L 53 54" stroke="var(--cork-dark)" strokeOpacity="0.6" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/** One path, shared by the fill, the clip and the rim, so they can never diverge. */
const BODY =
  'M 46 58 L 46 104 C 46 118, 22 126, 18 152 L 18 264 C 18 282, 30 292, 46 292 ' +
  'L 74 292 C 90 292, 102 282, 102 264 L 102 152 C 98 126, 74 118, 74 104 L 74 58 Z';

function RolledPaper({ open }) {
  return (
    <g className="bottle-paper" opacity={open ? 0 : 1} transform="rotate(-14 60 210)">
      <rect x="26" y="186" width="68" height="46" rx="8" fill="var(--paper)" />
      <rect x="26" y="186" width="68" height="46" rx="8" fill="var(--paper-shade)" opacity="0.5" />
      <path d="M 34 200 L 82 200 M 34 210 L 74 210 M 34 220 L 78 220" stroke="var(--paper-edge)" strokeWidth="2" />
      <ellipse cx="30" cy="209" rx="6" ry="23" fill="var(--paper)" />
      <ellipse cx="90" cy="209" rx="6" ry="23" fill="var(--paper-shade)" />
    </g>
  );
}
