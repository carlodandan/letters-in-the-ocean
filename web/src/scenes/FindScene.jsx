import { useCallback, useEffect, useRef, useState } from 'react';

import Bottle from '../components/Bottle.jsx';
import Letter from '../components/Letter.jsx';
import ReportDialog from '../components/ReportDialog.jsx';
import { ApiError, api } from '../api.js';
import { usePrefersReducedMotion, wait } from '../lib/motion.js';
import { Link } from '../router.jsx';

/**
 * Finding a bottle.
 *
 * The sequence is: look at the water, something drifts in, you open it, the
 * paper comes out, you read it, and then you decide what happens to it. Each
 * step is a stage in one small state machine rather than a pile of timers, and
 * every stage is reachable by keyboard: the bottle is a button from the moment
 * it appears, so nobody has to wait out an animation to act.
 *
 * With reduced motion the same stages happen with every delay set to zero.
 */

const STAGES_WITH_BOTTLE = new Set(['afloat', 'opening', 'gone']);

export default function FindScene({ onState, sound, reportReasons }) {
  const reduced = usePrefersReducedMotion();
  const [stage, setStage] = useState('searching');
  const [bottle, setBottle] = useState(null);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportNotice, setReportNotice] = useState('');
  const looked = useRef(false);

  const look = useCallback(async () => {
    setStage('searching');
    setNotice('');
    setProblem(false);
    try {
      const result = await api.findBottle();
      if (result.today) onState?.(result.today);
      if (!result.bottle) {
        setStage('empty');
        setNotice('Nobody has left anything yet. You could be the first.');
        return;
      }
      setBottle(result.bottle);
      setStage('afloat');
      sound.play('clink');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'daily_limit') {
        if (error.payload?.today) onState?.(error.payload.today);
        setStage('blocked');
        setNotice(error.message);
        return;
      }
      setStage('lost');
      setNotice(error?.message ?? 'Something went wrong out there.');
      setProblem(true);
    }
  }, [onState, sound]);

  useEffect(() => {
    if (looked.current) return;
    looked.current = true;
    void look();
  }, [look]);

  /** Cork, then paper, then the words. */
  async function openBottle() {
    if (stage !== 'afloat') return;
    setStage('opening');
    sound.play('cork');
    await wait(1600, reduced);
    sound.play('paper');
    await wait(800, reduced);
    setStage('reading');
  }

  async function sendFurther() {
    setBusy(true);
    try {
      const result = await api.sendFurther(bottle.id);
      if (result.today) onState?.(result.today);
      sound.play('splash');
      setStage('gone');
      setNotice(result.message);
      setProblem(false);
    } catch (error) {
      setNotice(error?.message ?? 'It would not leave your hands. Try again.');
      setProblem(true);
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(reason) {
    setBusy(true);
    setReportNotice('');
    try {
      const result = await api.report(bottle.id, reason);
      setReporting(false);
      setNotice(result.message);
      setProblem(false);
    } catch (error) {
      setReportNotice(error?.message ?? 'The report did not send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scene">
      <h1 className="scene-title">{TITLES[stage] ?? 'Out on the water'}</h1>

      {/*
        One live region for the whole scene. It says what happened, not what is
        animating, so it stays useful and stays quiet.
      */}
      <p className="visually-hidden" role="status">
        {STATUS[stage] ?? ''}
      </p>

      {STAGES_WITH_BOTTLE.has(stage) ? (
        <div className="bottle-field" data-phase={stage === 'gone' ? 'leaving' : 'approach'}>
          <Bottle
            open={stage !== 'afloat'}
            onOpen={stage === 'afloat' ? openBottle : undefined}
            label="Open the bottle and read the letter inside"
            halo={stage === 'afloat'}
          />
        </div>
      ) : null}

      {stage === 'reading' && bottle ? (
        <Letter bottle={bottle}>
          <div className="letter-actions">
            <Link className="tide-button" href={`/reply/${bottle.id}`}>
              Write back
            </Link>
            <button
              type="button"
              className="tide-button tide-button--quiet"
              onClick={sendFurther}
              disabled={busy}
            >
              Send it further
            </button>
            <Link className="tide-button tide-button--text" href="/">
              Fold it away
            </Link>
            <button
              type="button"
              className="tide-button tide-button--text"
              onClick={() => setReporting(true)}
            >
              Report
            </button>
          </div>
        </Letter>
      ) : null}

      {/*
        Everything the scene has to say in words — a refusal, a failed report, a
        letter sent on. Announced politely, because it is the outcome of
        something the visitor just did.
      */}
      <p className={problem ? 'notice notice--problem' : 'notice'} aria-live="polite">
        {notice}
      </p>

      {stage === 'empty' ? (
        <div className="actions">
          <Link className="tide-button" href="/write">
            Leave the first letter
          </Link>
        </div>
      ) : null}

      {stage === 'lost' ? (
        <div className="actions">
          <button type="button" className="tide-button tide-button--quiet" onClick={look}>
            Look again
          </button>
        </div>
      ) : null}

      {stage === 'gone' ? (
        <div className="actions">
          <button type="button" className="tide-button tide-button--quiet" onClick={look}>
            Look for another
          </button>
        </div>
      ) : null}

      {stage !== 'reading' && stage !== 'searching' ? (
        <Link className="tide-button tide-button--text" href="/">
          Back to the shore
        </Link>
      ) : null}

      <ReportDialog
        open={reporting}
        reasons={reportReasons}
        onClose={() => setReporting(false)}
        onSubmit={submitReport}
        busy={busy}
        notice={reportNotice}
      />
    </div>
  );
}

const TITLES = {
  searching: 'Looking out at the water',
  afloat: 'Something is drifting in',
  opening: 'Opening it',
  reading: 'A letter, for whoever found it',
  gone: 'Back into the water',
  empty: 'The water is quiet',
  blocked: 'Five bottles a day',
  lost: 'The ocean did not answer',
};

const STATUS = {
  afloat: 'A bottle has drifted within reach. Open it to read the letter inside.',
  reading: 'The letter is open and readable below.',
  gone: 'The letter is back in the water.',
  empty: 'Nobody has left a letter yet.',
  blocked: 'You have already found your five bottles today.',
  lost: 'The letter could not be fetched.',
};
