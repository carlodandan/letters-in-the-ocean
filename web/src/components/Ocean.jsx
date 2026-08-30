import { useEffect, useRef } from 'react';

import { usePrefersReducedMotion, useDocumentVisible } from '../lib/motion.js';

/**
 * The ocean.
 *
 * A single canvas draws sky, light, horizon, water, waves and drifting motes.
 * Colours are read from the CSS custom properties in styles/tokens.css so the
 * canvas and the interface can never disagree about what time of day it is.
 *
 * It is decoration and is hidden from assistive technology; every piece of
 * meaning lives in the DOM above it.
 */

const HORIZON = 0.42;
const WAVE_LAYERS = 5;
const MOTES = 34;
const MAX_DPR = 2;

function parseColor(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
      1,
    ];
  }
  const parts = text.match(/[\d.]+/g);
  if (!parts) return [0, 0, 0, 1];
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts[3] ? Number(parts[3]) : 1];
}

function rgba([r, g, b], alpha = 1) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

function mix(a, b, amount) {
  return a.map((channel, index) => channel + (b[index] - channel) * amount);
}

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name) => parseColor(styles.getPropertyValue(name));
  return {
    skyTop: token('--sky-top'),
    skyMid: token('--sky-mid'),
    skyHorizon: token('--sky-horizon'),
    lightCore: token('--light-core'),
    lightGlow: token('--light-glow'),
    seaFar: token('--sea-far'),
    seaMid: token('--sea-mid'),
    seaNear: token('--sea-near'),
    foam: token('--foam'),
    stars: Number.parseFloat(styles.getPropertyValue('--stars')) || 0,
  };
}

/** Deterministic pseudo-random, so the stars do not rearrange on every frame. */
function seeded(index) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function drawSky(ctx, { width, horizon }, palette) {
  const gradient = ctx.createLinearGradient(0, 0, 0, horizon);
  gradient.addColorStop(0, rgba(palette.skyTop));
  gradient.addColorStop(0.62, rgba(palette.skyMid));
  gradient.addColorStop(1, rgba(palette.skyHorizon));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, horizon);
}

function drawStars(ctx, { width, horizon }, palette, time) {
  if (palette.stars <= 0) return;
  ctx.fillStyle = rgba(palette.lightCore, palette.stars);
  for (let i = 0; i < 90; i += 1) {
    const x = seeded(i) * width;
    const y = seeded(i + 500) * horizon * 0.86;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(time * 0.0004 + i));
    const size = 0.5 + seeded(i + 900) * 1.1;
    ctx.globalAlpha = palette.stars * twinkle;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawLight(ctx, { width, horizon }, palette, lightX) {
  const radius = Math.max(28, Math.min(width, horizon) * 0.075);
  const y = horizon - radius * 2.6;

  const halo = ctx.createRadialGradient(lightX, y, radius * 0.4, lightX, y, radius * 11);
  halo.addColorStop(0, rgba(palette.lightGlow, 0.75));
  halo.addColorStop(0.35, rgba(palette.lightGlow, 0.22));
  halo.addColorStop(1, rgba(palette.lightGlow, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, horizon + radius * 4);

  ctx.beginPath();
  ctx.arc(lightX, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = rgba(palette.lightCore, 0.95);
  ctx.fill();

  // Haze where the water meets the sky, so the horizon is a suggestion.
  const haze = ctx.createLinearGradient(0, horizon - radius * 1.6, 0, horizon + radius * 0.6);
  haze.addColorStop(0, rgba(palette.skyHorizon, 0));
  haze.addColorStop(0.6, rgba(palette.lightGlow, 0.35));
  haze.addColorStop(1, rgba(palette.skyHorizon, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - radius * 1.6, width, radius * 2.2);
}

function drawSea(ctx, { width, height, horizon }, palette) {
  const gradient = ctx.createLinearGradient(0, horizon, 0, height);
  gradient.addColorStop(0, rgba(palette.seaFar));
  gradient.addColorStop(0.34, rgba(palette.seaMid));
  gradient.addColorStop(1, rgba(palette.seaNear));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, horizon, width, height - horizon);
}

/** The shimmering column of light on the water, directly under the sun or moon. */
function drawReflection(ctx, { width, height, horizon }, palette, time, lightX) {
  const rows = 26;
  ctx.save();
  for (let row = 0; row < rows; row += 1) {
    const progress = row / rows;
    const y = horizon + progress * progress * (height - horizon) * 0.92;
    const spread = 12 + progress * width * 0.16;
    const wobble = Math.sin(time * 0.0011 + row * 0.9) * spread * 0.55;
    const alpha = (1 - progress) * 0.16;
    ctx.fillStyle = rgba(palette.lightCore, alpha);
    ctx.beginPath();
    ctx.ellipse(lightX + wobble, y, spread, 1.4 + progress * 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWaves(ctx, { width, height, horizon }, palette, time) {
  const span = height - horizon;

  for (let layer = 0; layer < WAVE_LAYERS; layer += 1) {
    const depth = (layer + 1) / WAVE_LAYERS;
    const baseY = horizon + span * (0.1 + depth * depth * 0.85);
    const amplitude = 3 + depth * 22;
    const length = 140 + depth * 620;
    const speed = 0.00006 + depth * 0.00026;
    const colour = mix(palette.seaFar, palette.seaNear, 0.15 + depth * 0.85);

    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 6) {
      const y =
        baseY +
        Math.sin(x / length + time * speed) * amplitude +
        Math.sin(x / (length * 0.37) - time * speed * 1.7) * amplitude * 0.32;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = rgba(colour, 0.92);
    ctx.fill();

    // A thin crest where the light catches the top of each swell.
    ctx.beginPath();
    for (let x = 0; x <= width; x += 6) {
      const y =
        baseY +
        Math.sin(x / length + time * speed) * amplitude +
        Math.sin(x / (length * 0.37) - time * speed * 1.7) * amplitude * 0.32;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(palette.foam, 0.1 + (1 - depth) * 0.16);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawMotes(ctx, { width, height }, palette, time) {
  for (let i = 0; i < MOTES; i += 1) {
    const speed = 0.004 + seeded(i) * 0.012;
    const drift = (time * speed) % (width + 200);
    const x = ((seeded(i + 11) * width + drift) % (width + 200)) - 100;
    const y = seeded(i + 71) * height * 0.9 + Math.sin(time * 0.0005 + i) * 12;
    const size = 0.6 + seeded(i + 131) * 1.6;
    ctx.fillStyle = rgba(palette.foam, 0.1 + seeded(i + 191) * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function Ocean({ sky }) {
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const visible = useDocumentVisible();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return undefined;

    let palette = readPalette();
    let frame = 0;
    let geometry = { width: 0, height: 0, horizon: 0 };

    function measure() {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      geometry = { width, height, horizon: Math.round(height * HORIZON) };
    }

    function paint(time) {
      const { width, height } = geometry;
      const lightX = width * 0.63;
      ctx.clearRect(0, 0, width, height);
      drawSky(ctx, geometry, palette);
      drawStars(ctx, geometry, palette, time);
      drawLight(ctx, geometry, palette, lightX);
      drawSea(ctx, geometry, palette);
      drawReflection(ctx, geometry, palette, time, lightX);
      drawWaves(ctx, geometry, palette, time);
      if (!reduced) drawMotes(ctx, geometry, palette, time);
    }

    measure();
    // With reduced motion the ocean is a still painting: drawn once, redrawn on
    // resize, never animated.
    paint(reduced ? 8000 : performance.now());

    const observer = new ResizeObserver(() => {
      measure();
      palette = readPalette();
      paint(reduced ? 8000 : performance.now());
    });
    observer.observe(canvas);

    if (!reduced && visible) {
      const loop = (time) => {
        paint(time);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reduced, visible, sky]);

  return <canvas ref={canvasRef} className="ocean-canvas" aria-hidden="true" />;
}
