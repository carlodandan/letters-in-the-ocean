import { useCallback, useEffect, useRef, useState } from 'react';

import Ocean from './components/Ocean.jsx';
import SoundToggle from './components/SoundToggle.jsx';
import PrivacyModal from './components/PrivacyModal.jsx';
import FindScene from './scenes/FindScene.jsx';
import Landing from './scenes/Landing.jsx';
import WriteScene from './scenes/WriteScene.jsx';
import { api } from './api.js';
import { useSound } from './lib/audio.js';
import { skyLabel, useSky } from './lib/sky.js';
import { Link, useRoute } from './router.jsx';

/**
 * The shell.
 *
 * One ocean, painted once and never remounted, with a scene on top of it. The
 * URL decides the scene; the server decides what you are allowed to do today.
 * The client keeps a copy of that answer only to soften the interface — it is
 * never what enforces anything.
 */

const TITLES = {
  home: 'Letters in the Ocean',
  find: 'Finding a bottle · Letters in the Ocean',
  write: 'Leaving a letter · Letters in the Ocean',
  reply: 'Writing back · Letters in the Ocean',
};

export default function App() {
  const sky = useSky();
  const sound = useSound();
  const route = useRoute();
  const [state, setState] = useState(null);
  const [stats, setStats] = useState(null);
  const [lost, setLost] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const stage = useRef(null);
  const firstScene = useRef(true);

  const orient = useCallback(() => {
    api
      .state()
      .then(setState)
      .catch(() => setLost(true));
  }, []);

  const handleRetry = useCallback(() => {
    setLost(false);
    orient();
  }, [orient]);

  useEffect(() => {
    // Deliberately not aborted on unmount: this read is the shell's one-time
    // orientation, and cancelling it buys nothing while a dropped connection
    // costs a retry.
    orient();
    api.stats().then(setStats).catch(() => {});
  }, [orient]);

  useEffect(() => {
    document.title = TITLES[route.name] ?? TITLES.home;
  }, [route.name]);

  /*
   * Nothing reloads between scenes, so focus has to be moved deliberately: the
   * link that was clicked no longer exists, and a keyboard or screen-reader
   * visitor would otherwise be dropped at the top of the document with no idea
   * that the page changed. The first scene is left alone — arriving on a page
   * should not steal focus from the browser.
   */
  useEffect(() => {
    if (firstScene.current) {
      firstScene.current = false;
      return;
    }
    stage.current?.focus();
  }, [route.path]);

  const onState = useCallback((today) => {
    setState((current) => (current ? { ...current, today } : current));
  }, []);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to the water
      </a>
      <Ocean sky={sky} />
      <div className="vignette" aria-hidden="true" />

      <header className="chrome chrome--top">
        <p className="quiet">{skyLabel(sky)}</p>
        <SoundToggle on={sound.on} onToggle={sound.toggle} />
      </header>

      <main className="stage" id="main" ref={stage} tabIndex={-1}>
        <Scene
          route={route}
          state={state}
          stats={stats}
          lost={lost}
          onState={onState}
          onRetry={handleRetry}
          sound={sound}
        />
      </main>

      <footer className="chrome chrome--bottom">
        <p className="quiet">
          Anonymous, unrecorded, and gone when you close the tab. One letter, five bottles a day.
          <span style={{ margin: '0 0.5rem', opacity: 0.5 }}>•</span>
          <button 
            type="button" 
            className="quiet" 
            style={{ background: 'none', border: 'none', padding: 0, textDecoration: 'underline', textUnderlineOffset: '0.2em', cursor: 'pointer' }}
            onClick={() => setPrivacyOpen(true)}
          >
            Privacy
          </button>
        </p>
      </footer>
      
      <PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}

function Scene({ route, state, stats, lost, onState, onRetry, sound }) {
  // The homepage is worth reading before the server has said anything.
  if (route.name === 'home') return <Landing state={state} stats={stats} />;

  /*
   * Everything else acts, and acting needs an identity. GET /api/state is what
   * issues the anonymous session cookie, so nothing that acts may go out before
   * it has answered: three cookieless requests in flight at once would mint
   * three visitors, and the find would be recorded against one the browser then
   * threw away.
   */
  if (!state) return lost ? <Unreachable onRetry={onRetry} /> : <Settling />;

  switch (route.name) {
    case 'find':
      return (
        <FindScene key="find" onState={onState} sound={sound} reportReasons={state.reportReasons} />
      );
    case 'write':
      return <WriteScene key="write" onState={onState} sound={sound} limits={state.letter} />;
    case 'reply':
      return route.param ? (
        <WriteScene
          key={`reply:${route.param}`}
          onState={onState}
          sound={sound}
          limits={state.letter}
          replyTo={route.param}
        />
      ) : (
        <Lost />
      );
    default:
      return <Lost />;
  }
}

function Settling() {
  return (
    <div className="scene">
      <p className="quiet" role="status">
        The water is settling…
      </p>
    </div>
  );
}

function Unreachable({ onRetry }) {
  return (
    <div className="scene">
      <h1 className="scene-title">The ocean is out of reach</h1>
      <p className="lede">Nothing came back. It may be the connection rather than the water.</p>
      <div className="actions">
        <button type="button" className="tide-button" onClick={onRetry}>
          Try again
        </button>
        <Link className="tide-button tide-button--text" href="/">
          Back to the shore
        </Link>
      </div>
    </div>
  );
}

function Lost() {
  return (
    <div className="scene">
      <h1 className="scene-title">Nothing out here</h1>
      <p className="lede">That stretch of water is empty. The shore is back this way.</p>
      <Link className="tide-button" href="/">
        Back to the shore
      </Link>
    </div>
  );
}
