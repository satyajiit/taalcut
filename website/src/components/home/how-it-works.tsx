// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Paste, pick, approve · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (server HTML, reduced motion, after one pass: every frame full, none raised) · playing (once on
 *   screen: each step's story bar fills over about 4 s and its frame is raised, then the next, once through; off
 *   screen it holds) · paused (the visitor pressed Pause: held where it is) · a step chosen (a step button or a tap on
 *   a frame plays from there) · step buttons: default · hover (surface) · focus (base ring) · active (2 % give) ·
 *   current (filled, aria-current="step") · Pause/Play: default · hover · focus · active
 * The pass from a saved reel to your version, as three stories you tap through: three 9:16 frames side by side
 * from 768 px (a snapping row on phones, scrolled to the current one), the step buttons and the Pause the
 * sequence needs (it moves for more than 5 s: WCAG 2.2.2). */

import { Check, ClipboardPaste, Pause, Play } from 'lucide-react';
import { animate, motion, useInView, useMotionValue } from 'motion/react';
import { type ComponentType, useCallback, useEffect, useRef, useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { buttonClasses } from '#components/ui/button-classes';
import { IconText } from '#components/ui/icon-text';
import { Arrive, Section } from '#components/ui/section';
import { HOW } from '#content/home';
import { ICON_STROKE } from '#lib/icons';
import { EASE_OUT } from '#lib/motion';
import { ApproveFrame, type FrameProps, PasteFrame, PickFrame } from './how-frames';

/** Seconds a step's story takes to fill. */
const STEP_SECONDS = 4.2;
const FRAMES: readonly ComponentType<FrameProps>[] = [PasteFrame, PickFrame, ApproveFrame];
const STEP_ICON = [
  <ClipboardPaste key="paste" aria-hidden strokeWidth={ICON_STROKE} className="size-5" />,
  <AiMark key="pick" className="size-5" />,
  <Check key="approve" aria-hidden strokeWidth={ICON_STROKE} className="size-5" />,
] as const;
const STEP_TONE = ['beat', 'ai', 'you'] as const;
/** The current step's button: the secondary button's shape, filled with ink. */
const CURRENT_STEP =
  'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-pill border border-inverse bg-inverse px-4 type-label text-on-inverse ' +
  'select-none transition-transform duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100';

export function HowItWorks() {
  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLOListElement>(null);
  const reduce = useReducedMotionPref();
  const inView = useInView(root, { amount: 0.35 });
  const progress = [useMotionValue(1), useMotionValue(1), useMotionValue(1)] as const;
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  const from = useCallback(
    (step: number, run: boolean) => {
      // Only the step being told builds up; the others show their finished frame.
      progress.forEach((p, i) => p.set(run && i === step ? 0 : 1));
      setActive(step);
      setRunning(run);
    },
    // The motion values keep their identity for the component's life.
    [],
  );

  // The first time it's on screen, play the pass once.
  useEffect(() => {
    if (!inView || started || reduce) return;
    setStarted(true);
    from(0, true);
  }, [inView, started, reduce, from]);

  // Fill the current step's bar, then move on; off screen or paused, hold.
  useEffect(() => {
    if (!running || reduce || !inView) return undefined;
    const p = progress[active]!;
    const controls = animate(p, 1, {
      duration: Math.max(0.01, (1 - p.get()) * STEP_SECONDS),
      ease: 'linear',
      onComplete: () => {
        if (active < FRAMES.length - 1) setActive(active + 1);
        else setRunning(false);
      },
    });
    return () => controls.stop();
  }, [running, active, inView, reduce]);

  // On a phone the frames are a snapping row: keep the current one in view.
  useEffect(() => {
    const list = row.current;
    const frame = list?.children[active] as HTMLElement | undefined;
    if (!list || !frame || list.scrollWidth <= list.clientWidth + 1 || !started) return;
    list.scrollTo({ left: frame.offsetLeft - (list.clientWidth - frame.clientWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [active, started, reduce]);

  const choose = (step: number) => {
    setStarted(true);
    from(step, !reduce);
  };
  const finished = !running && active === FRAMES.length - 1 && progress[active]!.get() >= 1;
  const toggle = () => {
    setStarted(true);
    if (running) setRunning(false);
    else if (finished || !started) from(0, true);
    else setRunning(true);
  };
  const raised = started && !reduce;

  return (
    <Section id="how-it-works" heading={HOW.heading} lead={HOW.lead}>
      <div ref={root} className="flex flex-col gap-8">
        <Arrive className="flex flex-wrap items-center gap-2">
          {HOW.steps.map((step, i) => (
            <button
              key={step.id}
              type="button"
              onClick={() => choose(i)}
              aria-current={started && active === i ? 'step' : undefined}
              className={started && active === i ? CURRENT_STEP : buttonClasses('secondary', 'md')}
            >
              {HOW.stepButton(i + 1, step.title)}
            </button>
          ))}
          {reduce ? null : (
            <button type="button" onClick={toggle} className={buttonClasses('quiet', 'md', 'ms-auto')}>
              {running ? <Pause aria-hidden strokeWidth={ICON_STROKE} className="size-4" /> : <Play aria-hidden strokeWidth={ICON_STROKE} className="size-4" />}
              {running ? HOW.controls.pause : HOW.controls.play}
            </button>
          )}
        </Arrive>
        <Arrive>
          <ol
            ref={row}
            className="-mx-gutter flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-gutter px-gutter pt-4 pb-6 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-8 md:overflow-visible md:px-0 lg:gap-12"
          >
            {HOW.steps.map((step, i) => {
              const Frame = FRAMES[i]!;
              return (
                <motion.li
                  key={step.id}
                  data-step={step.id}
                  initial={false}
                  animate={{ scale: raised && active !== i ? 0.95 : 1, y: raised && active === i ? -6 : 0 }}
                  transition={{ duration: 0.45, ease: EASE_OUT }}
                  onClick={() => choose(i)}
                  className="flex w-[min(17rem,72vw)] shrink-0 snap-center flex-col gap-5 md:mx-auto md:w-full md:max-w-[18.5rem]"
                >
                  <Frame progress={progress[i]!} />
                  <div className="flex flex-col gap-2 px-1">
                    <h3 className="type-site-subhead text-ink">
                      <IconText mark={STEP_ICON[i]} tone={STEP_TONE[i]} size="lg">
                        {step.title}
                      </IconText>
                    </h3>
                    <p className="type-site-body text-ink-2">{step.line}</p>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </Arrive>
      </div>
    </Section>
  );
}
