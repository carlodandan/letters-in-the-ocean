import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reduced motion is treated as a first-class mode, not a degradation: the
 * bottle stops drifting, the letter stops unfolding, and every step of the
 * journey is still reachable.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const media = matchMedia(QUERY);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Used to stop the canvas painting while the tab is in the background. */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}

/**
 * Resolves after `ms`, or immediately when motion is reduced. Lets a scene
 * describe its pacing once instead of branching at every step.
 */
export function wait(ms, reduced) {
  return new Promise((resolve) => setTimeout(resolve, reduced ? 0 : ms));
}
