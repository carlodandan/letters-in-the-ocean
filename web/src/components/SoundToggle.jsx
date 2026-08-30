/**
 * The sound switch.
 *
 * Off until somebody asks. It is a real button reporting its state through
 * aria-pressed rather than a checkbox styled to look like a switch, because what
 * it does is start and stop something, not tick a preference.
 */
export default function SoundToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      className="tide-button tide-button--quiet"
      aria-pressed={on}
      onClick={onToggle}
    >
      <Waves muted={!on} />
      <span>{on ? 'Sound on' : 'Sound off'}</span>
    </button>
  );
}

function Waves({ muted }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        d="M1 11c2-2 3.2-2 5 0s3 2 5 0 3.2-2 5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {muted ? (
        <path d="M3 3l12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path
          d="M1 6c2-2 3.2-2 5 0s3 2 5 0 3.2-2 5 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.55"
        />
      )}
    </svg>
  );
}
