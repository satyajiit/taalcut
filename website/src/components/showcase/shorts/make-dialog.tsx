// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Make a short, the app's dialog · mode: Operate · system: WEB2 Remix Vernacular (Segmented; the demo's
 *   Create short is an ink pill: the page's one marigold fill is Download for Mac)
 * rebuilt lean from apps/renderer/src/features/shorts/make-short-button.tsx, in its words: the title and its line,
 *   the long video it was opened on, Target length (30 sec, 60 sec, 90 sec or Custom: Length in seconds, a whole
 *   number from 15 to 179), that the cut may run shorter, and Cancel and Create short. Shown open on the page, not as a
 *   modal: it takes no focus and traps none
 * states: Target length: the segmented control's · Custom: the field's default, hover, focus (base ring) and invalid
 *   (the app's alert under it; Create short disabled) · Cancel (secondary) and Create short (ink pill): default,
 *   hover, focus, active, disabled (Create short, while the length isn't one) · loading n/a (Create short plays the
 *   run in the window, and pressed again plays it from the start)
 * motion: the custom field opens by opacity (--dur-short); reduced motion: at once */

import { Film, Scissors } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useId, useState } from 'react';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { Segmented } from '../segmented';
import { customLength, DEFAULT_LENGTH, LENGTHS, lengthWords, LONG_VIDEO } from './trip';

type Choice = '30' | '60' | '90' | 'custom';

const OPTIONS: readonly { readonly value: Choice; readonly label: string }[] = [
  ...LENGTHS.map((n) => ({ value: String(n) as Choice, label: lengthWords(n) })),
  { value: 'custom', label: 'Custom' },
];

export const INK_PILL =
  'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-pill border border-inverse bg-inverse px-4 type-label font-semibold text-on-inverse transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) not-disabled:hover:bg-inverse/85 not-disabled:active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-control disabled:text-ink-disabled';

/** The length the dialog's choice asks for, or null while a custom one isn't a whole number from 15 to 179. */
export function chosenLength(choice: string, custom: string): number | null {
  return choice === 'custom' ? customLength(custom) : Number(choice);
}

export function MakeDialog({
  onCreate,
  onCancel,
}: {
  readonly onCreate: (seconds: number) => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<Choice>(String(DEFAULT_LENGTH) as Choice);
  const [custom, setCustom] = useState(String(DEFAULT_LENGTH));
  const seconds = chosenLength(choice, custom);
  return (
    <MotionConfig reducedMotion="user">
      <section
        role="group"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-line`}
        data-slot="make-short"
        className="flex flex-col gap-5 rounded-xl border border-rule-subtle bg-raised p-5 shadow-window"
      >
        <header className="flex flex-col gap-1.5">
          <h4 id={`${id}-title`} className="m-0 flex items-center gap-2 type-section text-ink">
            <Scissors aria-hidden className="size-4 shrink-0 text-ink-2" />
            Make a short
          </h4>
          <p id={`${id}-line`} className="m-0 type-body text-ink-2">
            Turn one long video into a portrait story with captions and your branding.
          </p>
        </header>
        <p className="m-0 flex items-center gap-2 type-body text-ink" translate="no">
          <Film aria-hidden className="size-4 shrink-0 text-teal-strong" />
          {LONG_VIDEO}
        </p>
        <div className="flex flex-col gap-2">
          <span className="type-label text-ink">Target length</span>
          <Segmented label="Target length" value={choice} onChange={setChoice} options={OPTIONS} />
          <AnimatePresence initial={false}>
            {choice === 'custom' ? (
              <motion.div
                key="custom"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.short, ease: EASE_OUT }}
                className="flex flex-col gap-1.5 pt-1"
              >
                <label htmlFor={`${id}-seconds`} className="type-label text-ink">
                  Length in seconds
                </label>
                <input
                  id={`${id}-seconds`}
                  type="number"
                  inputMode="numeric"
                  min={15}
                  max={179}
                  step={1}
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  aria-invalid={seconds === null}
                  aria-describedby={seconds === null ? `${id}-error` : undefined}
                  className={cn(
                    'h-10 w-32 rounded-lg border bg-canvas px-3 tc-mono type-body text-ink',
                    'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3 focus:border-ink-2',
                    seconds === null ? 'border-danger-strong' : 'border-rule-strong',
                  )}
                />
                {seconds === null ? (
                  <p id={`${id}-error`} role="alert" className="m-0 type-meta text-danger-strong">
                    Choose a whole number from 15 to 179 seconds.
                  </p>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <p className="m-0 type-meta text-ink-2">The final cut may be shorter to keep the story complete.</p>
        </div>
        <footer className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClasses('secondary', 'md')} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={INK_PILL}
            disabled={seconds === null}
            onClick={() => {
              if (seconds !== null) onCreate(seconds);
            }}
          >
            Create short
          </button>
        </footer>
      </section>
    </MotionConfig>
  );
}
