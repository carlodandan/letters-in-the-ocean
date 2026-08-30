import { useRef, useState } from 'react';

import Bottle from '../components/Bottle.jsx';
import { ApiError, api } from '../api.js';
import { countCharacters, formatCount } from '../lib/format.js';
import { usePrefersReducedMotion, wait } from '../lib/motion.js';
import { Link } from '../router.jsx';

/**
 * Leaving a letter.
 *
 * Three steps, and the middle one is the point: you write, you seal it, and only
 * then do you let it go. The seal is deliberately a separate deliberate act —
 * nothing leaves by accident.
 *
 * The same screen writes a reply, because a reply is not a comment. It is a new
 * letter that happens to know which letter it answers.
 */

const FALLBACK = { minLength: 8, maxLength: 500 };

export default function WriteScene({ onState, sound, limits, replyTo }) {
  const reduced = usePrefersReducedMotion();
  const { minLength, maxLength } = limits ?? FALLBACK;

  const [text, setText] = useState('');
  const [stage, setStage] = useState('writing');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = useRef(null);

  const count = countCharacters(text);
  const tooShort = count < minLength;
  const tooLong = count > maxLength;
  const ready = !tooShort && !tooLong;

  function seal() {
    // The button stays live even when the letter is too short: a control that
    // simply refuses to respond explains nothing, so it says what is missing and
    // puts the writer back on the paper.
    if (tooShort || tooLong) {
      setNotice(
        tooShort
          ? `A few more words first — ${formatCount(minLength)} characters at the least.`
          : `That is ${formatCount(count - maxLength)} more than a bottle holds. Trim it a little.`,
      );
      setProblem(true);
      field.current?.focus();
      return;
    }
    setNotice('');
    setProblem(false);
    sound.play('cork');
    setStage('bottling');
  }

  function reopen() {
    setStage('writing');
    setNotice('');
    setProblem(false);
    requestAnimationFrame(() => field.current?.focus());
  }

  async function release() {
    setBusy(true);
    setNotice('');
    setProblem(false);
    setStage('leaving');
    try {
      sound.play('splash');
      const result = replyTo ? await api.reply(replyTo, text) : await api.leaveLetter(text);
      if (result.today) onState?.(result.today);
      await wait(1200, reduced);
      setStage(result.pending ? 'held' : 'released');
      setNotice(result.message);
    } catch (error) {
      setStage('bottling');
      setNotice(error?.message ?? 'It did not make it into the water. Try again.');
      setProblem(true);
      // A refusal is about the words, so the writer is put back on the paper
      // with everything they wrote still there.
      if (error instanceof ApiError && error.code === 'letter_refused') setStage('refused');
    } finally {
      setBusy(false);
    }
  }

  const writing = stage === 'writing' || stage === 'refused';
  const sealed = stage === 'bottling' || stage === 'leaving';
  const done = stage === 'released' || stage === 'held';

  return (
    <div className="scene">
      <h1 className="scene-title">{replyTo ? 'Write back' : 'Leave a letter'}</h1>

      {writing ? (
        <div className="desk">
          <label className="quiet" htmlFor="letter">
            {replyTo
              ? 'They will never know who you are, and you will never know who they were.'
              : 'Encouragement, gratitude, advice, hope — something worth finding.'}
          </label>

          <div className="paper-field">
            <textarea
              id="letter"
              name="letter"
              ref={field}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Whoever finds this…"
              aria-describedby="letter-count"
              spellCheck="true"
              // Nothing here should be remembered by the browser and offered
              // back on the next visit: the letter is meant to be written once
              // and let go of.
              autoComplete="off"
            />
          </div>

          <div className="desk-foot">
            <span id="letter-count" className={tooLong ? 'counter counter--over' : 'counter'}>
              {formatCount(count)} / {formatCount(maxLength)}
            </span>
            <span>{lengthHint({ count, minLength, maxLength })}</span>
          </div>

          <p className={problem ? 'notice notice--problem' : 'notice'} aria-live="polite">
            {notice}
          </p>

          <div className="actions">
            <button type="button" className="tide-button" onClick={seal} aria-disabled={!ready}>
              Put it in a bottle
            </button>
            <Link className="tide-button tide-button--text" href="/">
              Not today
            </Link>
          </div>
        </div>
      ) : null}

      {sealed ? (
        <>
          <div className="bottle-field" data-phase={stage === 'leaving' ? 'leaving' : undefined}>
            <Bottle label="Your letter, sealed in a bottle" halo={stage === 'bottling'} />
          </div>
          <p className="lede">
            {stage === 'leaving' ? 'Letting it go…' : 'Sealed. It is ready whenever you are.'}
          </p>
          <p className={problem ? 'notice notice--problem' : 'notice'} aria-live="polite">
            {notice}
          </p>
          <div className="actions">
            <button type="button" className="tide-button" onClick={release} disabled={busy}>
              Release into the ocean
            </button>
            <button
              type="button"
              className="tide-button tide-button--text"
              onClick={reopen}
              disabled={busy}
            >
              Open it again
            </button>
          </div>
        </>
      ) : null}

      {done ? (
        <>
          <p className="lede">
            {stage === 'released'
              ? 'Your letter is out there now.'
              : 'Your letter is on its way. Someone will read it before the tide takes it.'}
          </p>
          <p className="notice">{notice}</p>
          <div className="actions">
            <Link className="tide-button tide-button--quiet" href="/">
              Back to the shore
            </Link>
          </div>
        </>
      ) : null}

      {/* The outcome, once, for anyone not watching the water. */}
      <p className="visually-hidden" role="status">
        {done ? notice : ''}
      </p>
    </div>
  );
}

function lengthHint({ count, minLength, maxLength }) {
  if (count === 0) return `Up to ${formatCount(maxLength)} characters`;
  if (count < minLength) return 'A little longer';
  if (count > maxLength) return `${formatCount(count - maxLength)} too many`;
  return 'Ready';
}
