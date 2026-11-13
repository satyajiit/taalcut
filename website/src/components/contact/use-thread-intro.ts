// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { type RefObject, useEffect, useLayoutEffect, useState } from 'react';

/**
 * The thread's opening: Taalcut types, its question sticker lands (it pops and settles), and the topic chips, the
 * sticker's answers, pop in one after another. Only on a full page load with motion allowed, and only once the thread
 * is on screen.
 *
 * The words are in the server HTML. INTRO_SCRIPT, inline right before the thread, marks the page (`data-contact-
 * typing` on <html>) before the first paint, which hides the opening's parts (`in-data-[contact-typing]:opacity-0`);
 * without JavaScript, or under reduced motion, it never runs and everything shows. Once React runs, this hook takes
 * the parts over (step 0: hidden by React's own class), removes the mark, and plays the steps. If the page never
 * hydrates, the script itself removes the mark after four seconds, so nothing stays hidden.
 */
export const INTRO_ATTRIBUTE = 'data-contact-typing';

export const INTRO_SCRIPT = `(function(){try{var m=window.matchMedia;if(!m||m('(prefers-reduced-motion: reduce)').matches)return;var h=document.documentElement;h.setAttribute('${INTRO_ATTRIBUTE}','');setTimeout(function(){h.removeAttribute('${INTRO_ATTRIBUTE}')},4000)}catch(e){}})();`;

/** The steps: 0 typing, 1 the question sticker, 2 its answers (the chips). `done` is the server HTML's state. */
export type IntroStep = 0 | 1 | 2 | 'done';

/** When each step lands after the thread comes on screen, in ms. */
const AT: readonly number[] = [0, 700, 1150];

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useThreadIntro(target: RefObject<Element | null>): IntroStep {
  const [step, setStep] = useState<IntroStep>('done');
  const [armed, setArmed] = useState(false);

  // Before the hydrated paint: take the parts over if the script marked the page, then lift the mark.
  useBrowserLayoutEffect(() => {
    const html = document.documentElement;
    if (!html.hasAttribute(INTRO_ATTRIBUTE)) return;
    setStep(0);
    setArmed(true);
  }, []);

  useBrowserLayoutEffect(() => {
    if (step === 0) document.documentElement.removeAttribute(INTRO_ATTRIBUTE);
  }, [step]);

  useEffect(() => {
    const el = target.current;
    if (!armed || !el) return undefined;
    const timers: number[] = [];
    const play = () => {
      AT.forEach((ms, i) => timers.push(window.setTimeout(() => setStep(i as IntroStep), ms)));
      timers.push(window.setTimeout(() => setStep('done'), (AT.at(-1) ?? 0) + 900));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        play();
      },
      // From when the thread's top is a fifth of the screen up from the bottom: the thread is tall, and a share of
      // its height would wait on a phone until it filled the screen.
      { threshold: 0, rootMargin: '0px 0px -20% 0px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [armed, target]);

  return step;
}

/** Whether a part of the opening shows at this step (1 the question sticker, 2 its answers). */
export function introShows(step: IntroStep, at: 1 | 2): boolean {
  return step === 'done' || step >= at;
}

/**
 * A part of the opening waiting for its step: hidden by the page's mark before React runs (a class, so the server
 * HTML never holds an inline opacity), then by React's own class until its step comes.
 */
export const INTRO_WAITING = 'in-data-[contact-typing]:opacity-0';
