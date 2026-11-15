// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the part's steps (TRIM1) · system: DESIGN.md v0.7
 * the fine control under the strip: the part a frame or half a second earlier, or later, in the clip. Two groups
 *   that wrap as groups, each named by its direction, so the row reads the same at any width; a button's name is
 *   its own words and the direction ("0.5s earlier"). A run of presses is one change (use-part-gestures.ts sends
 *   it once the presses stop)
 * states: default · hover · focus (the base ring) · disabled (locked, or another edit is on its way: the title
 *   says which). While this control's own change is landing the buttons stay on, and a press waits for it
 * motion: none
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { Button } from '@taalcut/ui';

export interface PartStepsProps {
  /** Why the steps are off, said in each button's title; undefined when they are on. */
  off: string | undefined;
  /** The id of the lines that say what a step does. */
  describedBy: string;
  onStep(direction: -1 | 1, large: boolean): void;
}

export function PartSteps({ off, describedBy, onStep }: PartStepsProps) {
  const { t, i18n } = useLingui();
  const half = i18n.number(0.5, { style: 'unit', unit: 'second', unitDisplay: 'narrow' });
  const amount = 1;
  const frame = plural(amount, { one: '# frame', other: '# frames' });
  // A button's name holds the words it shows: "0.5s earlier", "1 frame later".
  const earlier = (step: string) => t`${step} earlier`;
  const later = (step: string) => t`${step} later`;
  const groups = [
    {
      key: 'earlier',
      name: t({ message: 'Earlier', context: 'towards the start of a clip' }),
      steps: [
        { key: 'half-earlier', direction: -1, large: true, words: half, label: earlier(half) },
        { key: 'frame-earlier', direction: -1, large: false, words: frame, label: earlier(frame) },
      ],
    },
    {
      key: 'later',
      name: t({ message: 'Later', context: 'towards the end of a clip' }),
      steps: [
        { key: 'frame-later', direction: 1, large: false, words: frame, label: later(frame) },
        { key: 'half-later', direction: 1, large: true, words: half, label: later(half) },
      ],
    },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t`Move the part`}
      aria-describedby={describedBy}
      data-slot="part-steps"
      className="flex flex-wrap items-center gap-x-4 gap-y-1"
    >
      {groups.map((group) => (
        <span key={group.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="type-meta text-ink-2">
            {group.name}
          </span>
          {group.steps.map((step) => (
            <Button
              key={step.key}
              size="sm"
              variant="secondary"
              data-step={step.key}
              aria-label={step.label}
              title={off ?? step.label}
              disabled={off !== undefined}
              onClick={() => onStep(step.direction, step.large)}
              className="tabular-nums"
            >
              {step.words}
            </Button>
          ))}
        </span>
      ))}
    </div>
  );
}
