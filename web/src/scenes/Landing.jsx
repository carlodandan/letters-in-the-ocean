import { Link } from '../router.jsx';
import { formatCount } from '../lib/format.js';

/**
 * The homepage.
 *
 * Two things to do and nothing else. No feed, no counters shouting at you, no
 * onboarding — the whole page is one sentence and a choice.
 */
export default function Landing({ state, stats }) {
  const find = state?.today?.find;
  const letter = state?.today?.letter;
  const alreadyFound = Boolean(find?.bottleId);

  return (
    <div className="scene">
      <p className="eyebrow">Letters in the Ocean</p>
      <h1 className="title">The ocean remembers</h1>
      <p className="lede">
        Somewhere out there, someone left a few words meant for whoever finds them.
      </p>

      <div className="actions">
        <Link className="tide-button" href="/find">
          {alreadyFound ? 'Read today’s bottle' : 'Find a bottle'}
        </Link>
        <Link className="tide-button" href="/write">
          Leave a letter
        </Link>
      </div>

      <div>
        <p className="quiet">{findHint(find, alreadyFound)}</p>
        {letter && !letter.available ? (
          <p className="quiet" style={{ marginTop: '0.5rem' }}>Your letter for today is already out there.</p>
        ) : null}
      </div>

      {stats ? (
        <p className="quiet stats">
          {formatCount(stats.letters)} letters adrift · {formatCount(stats.foundToday)} found today
        </p>
      ) : null}
    </div>
  );
}

function findHint(find, alreadyFound) {
  if (alreadyFound) return 'You have found today’s bottle. It is still in your hands.';
  if (find && !find.available) return 'No more bottles today. The tide brings another tomorrow.';
  return 'One bottle today';
}
