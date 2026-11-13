// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useMotionValue, useMotionValueEvent } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { type ReelIntent, reelShouldPlay } from '#components/ui/reel-play';
import { sceneAt, sceneSpans, type Scene, totalSeconds } from './story';

/**
 * The finished launch video's clock, as a reel frame plays one (#components/ui/reel-play): once the video is ready it
 * plays on its own while half on screen in a shown tab, never on its own under reduced motion, and the visitor's Pause
 * or Play wins. `time` is the video's clock in seconds (it drives the scene bar without a render a frame); `scene` is
 * the scene at that time, and `second` the whole second, for the timecode. `seek` jumps to a scene's start; `hold`
 * sets the clock while the video is still being made (the scene bar fills as production designs each scene).
 */
export function useScenePlayer(scenes: readonly Pick<Scene, 'seconds'>[], ready: boolean) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPref();
  const time = useMotionValue(0);
  const [scene, setScene] = useState(0);
  const [second, setSecond] = useState(0);
  const [intent, setIntent] = useState<ReelIntent>('auto');
  const [onScreen, setOnScreen] = useState(false);
  const [tabShown, setTabShown] = useState(true);
  const playing = ready && reelShouldPlay({ intent, autoPlay: true, reduce, onScreen, tabShown });
  const total = totalSeconds(scenes);
  const lengths = useRef(scenes);
  lengths.current = scenes;

  useMotionValueEvent(time, 'change', (t) => {
    const at = sceneAt(lengths.current, t);
    setScene((s) => (s === at ? s : at));
    const whole = Math.floor(t + 1e-6);
    setSecond((s) => (s === whole ? s : whole));
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setOnScreen((entry?.intersectionRatio ?? 0) >= 0.5), { threshold: [0, 0.5, 1] });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setTabShown(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    let last = performance.now();
    let frame = window.requestAnimationFrame(function tick(now) {
      const next = time.get() + (now - last) / 1000;
      last = now;
      time.set(total > 0 ? next % total : 0);
      frame = window.requestAnimationFrame(tick);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [playing, time, total]);

  const seek = useCallback(
    (index: number) => {
      const span = sceneSpans(lengths.current)[index];
      if (span) time.set(span[0]);
    },
    [time],
  );
  const hold = useCallback((t: number) => time.set(t), [time]);
  const toggle = useCallback(() => setIntent(playing ? 'paused' : 'playing'), [playing]);
  /** Back to the start, the visitor's Pause or Play forgotten (Play again). */
  const reset = useCallback(() => {
    setIntent('auto');
    time.set(0);
  }, [time]);

  return { ref, time, scene, second, total, playing, toggle, seek, hold, reset };
}

export type ScenePlayer = ReturnType<typeof useScenePlayer>;
