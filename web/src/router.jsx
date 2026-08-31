import { useSyncExternalStore } from 'react';

/* eslint-disable react-refresh/only-export-components */

/**
 * A very small history router.
 *
 * The URL is the source of truth for which scene you are in, so /find and /write
 * are shareable, bookmarkable and survive a refresh — and the back button does
 * what the back button should do. Links are real anchors; only actions are
 * buttons.
 */

const NAVIGATE_EVENT = 'lio:navigate';

function subscribe(callback) {
  window.addEventListener('popstate', callback);
  window.addEventListener(NAVIGATE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

function snapshot() {
  return window.location.pathname;
}

export function useRoute() {
  const path = useSyncExternalStore(subscribe, snapshot, () => '/');
  const segments = path.split('/').filter(Boolean);
  return { path, name: segments[0] ?? 'home', param: segments[1] ?? null };
}

export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/**
 * An anchor that navigates in place. Middle-click, ctrl-click and "open in new
 * tab" all keep working because the href is real.
 */
export function Link({ href, onNavigate, children, ...rest }) {
  function handleClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.();
    navigate(href);
  }

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
