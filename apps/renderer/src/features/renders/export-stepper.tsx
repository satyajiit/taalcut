// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the export's steps row (UX4) · system: DESIGN.md v0.6 + UX4
 * the steps in order across the dialog, each a small button with its number and its name, joined by a hairline:
 *   the current one's number on the ink fill (`inverse`), one already seen ticked on a chip, one still ahead
 *   outlined. Any step can be opened from here (every choice already has a working default), so the summary is one
 *   press away; Back and Next stay the main way through
 * states: default · hover (the hover surface eases in) · focus-visible (the base ring, instant) · active (gives by
 *   2 %, the pressed surface) · current (aria-current="step") · seen (ticked) · disabled n/a
 */
import { useLingui } from '@lingui/react/macro';
import { cn, HOVER_EASE, PRESS_CONTROL } from '@taalcut/ui';
import { Check } from 'lucide-react';
import type { ExportStep, ExportStepId } from './export-steps';

export interface ExportStepperProps {
  steps: readonly ExportStep[];
  current: ExportStepId;
  seen: ReadonlySet<ExportStepId>;
  onPick: (step: ExportStepId) => void;
}

export function ExportStepper({ steps, current, seen, onPick }: ExportStepperProps) {
  const { t, i18n } = useLingui();
  return (
    <nav aria-label={t`Export steps`} data-slot="export-stepper">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1 p-0">
        {steps.map((step, index) => {
          const here = step.id === current;
          const done = !here && seen.has(step.id);
          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 ? <span aria-hidden className="h-px w-3 shrink-0 bg-rule" /> : null}
              <button
                type="button"
                data-step={step.id}
                aria-current={here ? 'step' : undefined}
                onClick={() => onPick(step.id)}
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 type-label-sm whitespace-nowrap',
                  HOVER_EASE,
                  PRESS_CONTROL,
                  'hover:bg-hover hover:text-ink active:bg-pressed',
                  here ? 'text-ink' : 'text-ink-2',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border type-caption tabular-nums',
                    here
                      ? 'border-inverse bg-inverse text-on-inverse'
                      : done
                        ? 'border-rule bg-chip text-ink-2'
                        : 'border-rule-strong text-ink-3',
                  )}
                >
                  {done ? <Check className="size-3" /> : i18n.number(index + 1)}
                </span>
                {i18n._(step.name)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
