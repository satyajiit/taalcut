// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useMotionValue, type MotionValue } from 'motion/react';
import { useEffect, useState, type RefObject } from 'react';

/**
 * A video's own clock as a motion value: its currentTime, read each frame while `running`. Whatever follows it (the
 * version made from the picks, the beat ticks) stays in step with the footage, and stalls when the footage stalls.
 */
export function useVideoClock(videoRef: RefObject<HTMLVideoElement | null>, running: boolean): MotionValue<number> {
  const clock = useMotionValue(0);
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && video.currentTime !== clock.get()) clock.set(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [videoRef, running, clock]);
  return clock;
}

/** Whether an element is within `margin` of the viewport: `near` latches once true, `visible` follows it. */
export function useInView(ref: RefObject<HTMLElement | null>, margin = '0px'): { readonly near: boolean; readonly visible: boolean } {
  const [state, setState] = useState({ near: false, visible: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setState({ near: true, visible: true });
      return;
    }
    const nearIo = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setState((s) => (s.near ? s : { ...s, near: true }));
    }, { rootMargin: margin });
    const visibleIo = new IntersectionObserver(([entry]) => {
      const visible = entry?.isIntersecting ?? false;
      setState((s) => (s.visible === visible ? s : { ...s, visible }));
    });
    nearIo.observe(el);
    visibleIo.observe(el);
    return () => {
      nearIo.disconnect();
      visibleIo.disconnect();
    };
  }, [ref, margin]);
  return state;
}
