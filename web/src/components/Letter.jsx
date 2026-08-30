import { formatAge, formatCount, toParagraphs } from '../lib/format.js';

/**
 * A found letter.
 *
 * Not a modal, not a card: a sheet of paper that rises out of the water and
 * unfolds. The whole text is in the DOM from the first frame — the staggered
 * reveal is a CSS animation over content that is already there, so a screen
 * reader, a search of the page, or somebody with reduced motion gets everything
 * at once rather than waiting on JavaScript to finish being atmospheric.
 */
export default function Letter({ bottle, children }) {
  const paragraphs = toParagraphs(bottle.message);
  const age = formatAge(bottle.releasedOn);

  return (
    <>
      <article className="letter" aria-label="The letter you found">
        <div className="letter-text">
          {paragraphs.map((paragraph, index) => (
            <p key={index} style={{ '--line': index }}>
              {paragraph}
            </p>
          ))}
        </div>

        <p className="letter-sign" aria-hidden="true">
          — someone
        </p>

        <footer className="letter-meta">
          <span>{age ? `Written ${age}` : 'Written a while ago'}</span>
          <span>{describeTravel(bottle)}</span>
        </footer>
      </article>
      {children}
    </>
  );
}

/**
 * The only "statistic" a finder ever sees, and it is about the letter's journey
 * rather than anybody's popularity. Deliberately no counts of likes, replies to
 * you, or anything a person could compete over.
 */
function describeTravel({ timesFound = 0, journeys = 0 }) {
  if (journeys > 0) {
    return journeys === 1
      ? 'Sent on by one stranger'
      : `Sent on by ${formatCount(journeys)} strangers`;
  }
  if (timesFound > 1) return `Found ${formatCount(timesFound)} times`;
  return 'Found for the first time';
}
