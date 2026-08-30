import { useEffect, useRef, useState } from 'react';

/**
 * Reporting a letter.
 *
 * A native <dialog> opened with showModal(), which brings focus trapping, Escape
 * and inertness on the rest of the page for free rather than reimplementing all
 * three imperfectly.
 */

const LABELS = {
  spam: 'Spam or advertising',
  harassment: 'Cruel or abusive',
  hate: 'Hateful towards a group',
  sexual: 'Sexual content',
  scam: 'A scam or a phishing attempt',
  disturbing: 'Disturbing or frightening',
  other: 'Something else',
};

export default function ReportDialog({ open, reasons, onClose, onSubmit, busy, notice }) {
  const ref = useRef(null);
  const [reason, setReason] = useState('harassment');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(reason);
  }

  const available = reasons?.length ? reasons : Object.keys(LABELS);

  return (
    <dialog className="sheet" ref={ref} onClose={onClose} aria-labelledby="report-title">
      <form onSubmit={handleSubmit}>
        <h2 id="report-title">Report this letter</h2>
        <p className="notice">
          Nobody sees who reported what. A person will read it and take the letter out of the
          water if it does not belong here.
        </p>

        <fieldset>
          <legend>What is wrong with it?</legend>
          {available.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              <span>{LABELS[value] ?? value}</span>
            </label>
          ))}
        </fieldset>

        <p className={notice ? 'notice notice--problem' : 'notice'}>{notice}</p>

        <div className="sheet-actions">
          <button
            type="button"
            className="tide-button tide-button--text"
            onClick={() => ref.current?.close()}
          >
            Never mind
          </button>
          <button type="submit" className="tide-button tide-button--quiet" disabled={busy}>
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
