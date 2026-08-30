import { useEffect, useState } from 'react';

/**
 * The ocean is lit by the visitor's own clock. Arriving at seven in the evening
 * should feel different from arriving at two in the morning, without anybody
 * having to choose a theme.
 */
export function skyPhase(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour >= 4.5 && hour < 7.5) return 'dawn';
  if (hour >= 7.5 && hour < 16.5) return 'day';
  if (hour >= 16.5 && hour < 20.5) return 'sunset';
  return 'night';
}

export function skyLabel(phase) {
  switch (phase) {
    case 'dawn':
      return 'first light';
    case 'day':
      return 'open water';
    case 'sunset':
      return 'last of the light';
    default:
      return 'moonlight';
  }
}

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Keeps <html data-sky> and the browser chrome colour in step with the palette,
 * so the address bar on a phone matches the water it sits above.
 */
export function useSky() {
  const [phase, setPhase] = useState(() => skyPhase());

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.sky = phase;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      const sea = getComputedStyle(root).getPropertyValue('--sea-near').trim();
      if (sea) themeColor.setAttribute('content', sea);
    }
  }, [phase]);

  useEffect(() => {
    const timer = setInterval(() => setPhase(skyPhase()), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  return phase;
}
