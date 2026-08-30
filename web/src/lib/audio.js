import { useCallback, useEffect, useState } from 'react';

/**
 * Ambient sound, synthesised rather than downloaded — a few hundred lines of
 * filtered noise instead of a megabyte of ocean.wav, which also means the
 * bottle never waits on a network request to make a sound.
 *
 * Off by default. Nothing is constructed until somebody asks for it, because an
 * AudioContext created without a gesture is a blocked AudioContext.
 */

const AMBIENCE_GAIN = 0.075;

let context = null;
let ambience = null;

function noiseBuffer(ctx, seconds = 4) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    // Brown-ish noise: much closer to water than white noise is.
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  return buffer;
}

function ensureContext() {
  if (context) return context;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

function startAmbience(ctx) {
  if (ambience) return ambience;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;

  const surf = ctx.createBiquadFilter();
  surf.type = 'lowpass';
  surf.frequency.value = 480;
  surf.Q.value = 0.7;

  const spray = ctx.createBiquadFilter();
  spray.type = 'bandpass';
  spray.frequency.value = 2600;
  spray.Q.value = 0.5;

  const sprayGain = ctx.createGain();
  sprayGain.gain.value = 0.16;

  const master = ctx.createGain();
  master.gain.value = 0;

  // A slow swell, so the loop never announces itself.
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.055;
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = 180;
  swell.connect(swellDepth).connect(surf.frequency);

  source.connect(surf).connect(master);
  source.connect(spray).connect(sprayGain).connect(master);
  master.connect(ctx.destination);

  source.start();
  swell.start();
  master.gain.linearRampToValueAtTime(AMBIENCE_GAIN, ctx.currentTime + 3);

  ambience = { source, master, swell };
  return ambience;
}

function envelope(ctx, node, { peak, attack, decay }) {
  const now = ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(0.0001, now);
  node.gain.exponentialRampToValueAtTime(peak, now + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
}

const EFFECTS = {
  /** Glass tapped under water. */
  clink(ctx) {
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    for (const [frequency, detune] of [
      [2180, 0],
      [3260, 8],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    }
    envelope(ctx, gain, { peak: 0.09, attack: 0.004, decay: 0.32 });
  },

  /** Cork leaving the neck: a short pitch drop plus a puff of air. */
  cork(ctx) {
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.12);
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);

    const puff = ctx.createBufferSource();
    puff.buffer = noiseBuffer(ctx, 0.3);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    const puffGain = ctx.createGain();
    puff.connect(band).connect(puffGain).connect(ctx.destination);
    puff.start();
    puff.stop(ctx.currentTime + 0.2);
    envelope(ctx, puffGain, { peak: 0.05, attack: 0.005, decay: 0.14 });
    envelope(ctx, gain, { peak: 0.12, attack: 0.005, decay: 0.16 });
  },

  /** Paper unrolling. */
  paper(ctx) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, 1);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1200, ctx.currentTime);
    band.frequency.linearRampToValueAtTime(3200, ctx.currentTime + 0.5);
    band.Q.value = 1.4;
    const gain = ctx.createGain();
    source.connect(band).connect(gain).connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 0.7);
    envelope(ctx, gain, { peak: 0.055, attack: 0.06, decay: 0.5 });
  },

  /** A bottle entering the water. */
  splash(ctx) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, 1.5);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(3200, ctx.currentTime);
    low.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 1.1);
    const gain = ctx.createGain();
    source.connect(low).connect(gain).connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 1.4);
    envelope(ctx, gain, { peak: 0.14, attack: 0.01, decay: 1.1 });
  },
};

let enabled = false;

async function enable() {
  const ctx = ensureContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') await ctx.resume();
  startAmbience(ctx);
  if (ambience) ambience.master.gain.linearRampToValueAtTime(AMBIENCE_GAIN, ctx.currentTime + 2);
  enabled = true;
  return true;
}

async function disable() {
  enabled = false;
  if (!context || !ambience) return;
  ambience.master.gain.linearRampToValueAtTime(0.0001, context.currentTime + 0.6);
  const ctx = context;
  setTimeout(() => {
    if (!enabled && ctx.state === 'running') ctx.suspend().catch(() => {});
  }, 800);
}

export function playEffect(name) {
  if (!enabled || !context || context.state !== 'running') return;
  try {
    EFFECTS[name]?.(context);
  } catch {
    /* Audio is decoration; a failure here must never break the journey. */
  }
}

/**
 * Sound toggle state. Nothing is stored anywhere: the preference lasts as long
 * as the visit does, which is the same lifetime as everything else here.
 */
export function useSound() {
  const [on, setOn] = useState(false);

  const toggle = useCallback(async () => {
    if (on) {
      await disable();
      setOn(false);
      return;
    }
    setOn(await enable());
  }, [on]);

  useEffect(
    () => () => {
      void disable();
    },
    [],
  );

  return { on, toggle, play: playEffect };
}
