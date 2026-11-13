// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: first run's step rail (UX4) · genre: atmospheric studio app (brand moment, quiet) · system: DESIGN.md
 *   v0.4 + _orch/ux4/specs/design-onb.md
 * the steps as beats: this one a marigold sam, passed ones filled ink-3, those to come hollow (a khali); "Step N of
 *   M" above them in tabular figures (type-meta). Until the build says whether it has a terms step, still bones
 *   hold the rail's place, so neither the count nor the list changes size under the person (v0.4, UX1).
 * motion: the beat travels. A step reached from another starts its marigold beat on the step you left and glides it
 *   to this one (transform only, --dur-short, ease-out), so the rail says "you moved on" the way the timeline's
 *   playhead does. Reduced motion: the beat is simply there.
 * states (links): default (ink-3) · hover (ink, eased) · focus (base ring, instant) · active (pressed: ink, gives
 *   1 %) · current (aria-current="step", 600) · passed (ink-2) · loading (bones, aria-busy) ·
 *   disabled/error/success n/a (every step can be opened; the step itself says what failed)
 */
import { useLingui } from '@lingui/react/macro';
import { DUR, EASE_OUT, PRESS_ROW, cn, cssEase, useHostPlatform, useReducedMotion } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
import type { FirstRunScreen } from './step-memory';
import { stepCopy, type OnboardingStep } from './steps';

/** The rail's place while the build's steps are unknown: the count and three rows, as bones. */
function RailBones() {
  const { t } = useLingui();
  return (
    <div aria-busy="true" className="flex flex-col gap-3 pt-2" data-slot="step-rail-bones">
      <span className="sr-only" role="status">
        {t`Loading`}
      </span>
      <span aria-hidden className="tc-bone block h-4 w-20 rounded-sm bg-hover" />
      <span aria-hidden className="flex flex-col">
        {[24, 18, 22].map((width, i) => (
          <span key={i} className="flex items-center gap-3 py-1.5">
            <span className="tc-bone size-2 shrink-0 rounded-pill bg-hover" />
            <span className="tc-bone block h-3.5 rounded-sm bg-hover" style={{ width: `${width * 4}px` }} />
          </span>
        ))}
      </span>
    </div>
  );
}

/** The current beat glides in from the step you left, once, when the rail first shows on a new step. */
function useBeatGlide(current: OnboardingStep, from: FirstRunScreen | null, ready: boolean) {
  const list = useRef<HTMLOListElement>(null);
  const glided = useRef(false);
  const reduce = useReducedMotion() ?? false;
  useLayoutEffect(() => {
    const ol = list.current;
    if (!ol || glided.current) return;
    glided.current = true;
    if (!from || from === 'welcome' || from === current || reduce) return;
    const dot = (step: string) =>
      ol.querySelector<HTMLElement>(`[data-rail-step="${step}"] [data-slot=rail-dot]`);
    const start = dot(from);
    const beat = dot(current)?.querySelector<HTMLElement>('[data-slot=rail-beat]');
    if (!start || !beat || typeof beat.animate !== 'function') return;
    const dy = start.getBoundingClientRect().top - beat.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    beat.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
      duration: DUR.short * 1000,
      easing: cssEase(EASE_OUT),
    });
    // Once, when the rail's steps first show (after its bones): the step you came from doesn't change meanwhile.
  }, [ready]);
  return list;
}

/** Where you are: every step by name, each a link (all of first run can be skipped, and each step revisited). */
export function StepRail({
  current,
  steps,
  ready,
  from = null,
}: {
  current: OnboardingStep;
  /** The rail's steps (railSteps): they always include the open one. */
  steps: readonly OnboardingStep[];
  ready: boolean;
  /** The screen shown before this one in this window, if any: the beat glides from it. */
  from?: FirstRunScreen | null;
}) {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  const list = useBeatGlide(current, from, ready);
  if (!ready) return <RailBones />;
  const index = Math.max(0, steps.indexOf(current));
  const position = i18n.number(index + 1);
  const total = i18n.number(steps.length);
  return (
    <nav aria-label={t`Setup steps`} className="flex flex-col gap-3 pt-2">
      <p className="m-0 type-meta text-ink-3 tabular-nums">{t`Step ${position} of ${total}`}</p>
      <ol ref={list} className="m-0 flex list-none flex-col p-0">
        {steps.map((step, i) => {
          const state = i < index ? 'passed' : i === index ? 'current' : 'next';
          return (
            <li key={step} data-rail-step={step}>
              <Link
                to="/onboarding/$step"
                params={{ step }}
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn(
                  'flex origin-left items-center gap-3 rounded-sm py-1.5 type-label',
                  PRESS_ROW,
                  state === 'current'
                    ? 'font-semibold text-ink'
                    : 'text-ink-3 hover:text-ink active:text-ink',
                  state === 'passed' && 'text-ink-2',
                )}
              >
                <span
                  data-slot="rail-dot"
                  className="flex size-2.5 shrink-0 items-center justify-center"
                  aria-hidden
                >
                  {state === 'current' ? (
                    <span data-slot="rail-beat" className="size-2.5 rounded-pill bg-primary-strong" />
                  ) : (
                    <span
                      className={cn(
                        'size-2 rounded-pill',
                        state === 'passed' ? 'bg-ink-3' : 'border border-rule-strong',
                      )}
                    />
                  )}
                </span>
                {i18n._(stepCopy(step, platform).name)}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
