import { useCallback, useEffect, useState } from 'react';

import Ocean from './components/Ocean.jsx';
import SoundToggle from './components/SoundToggle.jsx';
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

  useEffect(() => {
    // Deliberately not aborted on unmount: this pair of reads is the shell's
    // one-time orientation, and cancelling them buys nothing while a dropped
    // connection costs a retry.
    let live = true;
    api.state().then((value) => live && setState(value)).catch(() => {});
    api.stats().then((value) => live && setStats(value)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    document.title = TITLES[route.name] ?? TITLES.home;
  }, [route.name]);

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

      <main className="stage" id="main">
        <Scene route={route} state={state} stats={stats} onState={onState} sound={sound} />
      </main>

      <footer className="chrome chrome--bottom">
        <p className="quiet">
          Anonymous, unrecorded, and gone when you close the tab. One letter, one bottle a day.
        </p>
      </footer>
    </div>
  );
}

function Scene({ route, state, stats, onState, sound }) {
  switch (route.name) {
    case 'find':
      return (
        <FindScene
          key="find"
          onState={onState}
          sound={sound}
          reportReasons={state?.reportReasons}
        />
      );
    case 'write':
      return <WriteScene key="write" onState={onState} sound={sound} limits={state?.letter} />;
    case 'reply':
      return route.param ? (
        <WriteScene
          key={`reply:${route.param}`}
          onState={onState}
          sound={sound}
          limits={state?.letter}
          replyTo={route.param}
        />
      ) : (
        <Lost />
      );
    case 'home':
      return <Landing state={state} stats={stats} />;
    default:
      return <Lost />;
  }
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
