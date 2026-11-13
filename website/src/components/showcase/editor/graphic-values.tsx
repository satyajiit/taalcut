// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a graphic the AI designed, and its values · mode: Operate · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (the viewer grey
 *   in both themes; the AI's work marked violet with the AI mark, your changes teal, each with its words)
 * rebuilt lean from apps/renderer/src/features/timeline/graphic-inspector.tsx and the design fixtures' variables:
 *   the preview (the frame of the owner's footage under the playhead, the AI's title, the captions with the word
 *   being said, each on a solid viewer band so it reads over any frame; the title and captions are made up for the
 *   demo, as its caption says) and the title's two values: Size (a slider) and Place (a segmented choice). The
 *   design stays the AI's; the values are yours once you change them, and Back to the AI's values puts them back
 * states: slider: default · hover · focus (base ring) · active (dragging) · disabled n/a; Place: the segmented
 *   control's; values the AI's (violet chip) or yours (teal chip, the reset button) · loading/error n/a (sample)
 * motion: the title moves and scales to its new values by transform (--dur-short, ease-out); reduced motion: at once */

import { motion, MotionConfig } from 'motion/react';
import { useId } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { buttonClasses } from '#components/ui/button';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { SHOWCASE_ICONS } from '../icons';
import { Segmented } from '../segmented';
import { SIZE_RANGE, TITLE, type CaptionWord, type Place } from './cut';

const PLACE_Y: Record<Place, string> = { top: '0%', middle: '34%', bottom: '58%' };
const PLACES: readonly { readonly value: Place; readonly label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];

export function TitlePreview({
  size,
  place,
  sprite,
  caption,
}: {
  readonly size: number;
  readonly place: Place;
  /** The frame under the playhead, from the atlas. */
  readonly sprite: number | undefined;
  readonly caption: { readonly line: readonly CaptionWord[]; readonly word: number } | null;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <figure className="m-0 flex flex-col gap-2">
        <div className="tc-viewer relative aspect-[9/16] w-full overflow-hidden rounded-xl">
          <ClipFrame sprite={sprite} className="absolute inset-0 size-full" />
          <motion.div aria-hidden className="absolute inset-0" initial={false} animate={{ y: PLACE_Y[place] }} transition={{ duration: DUR.short, ease: EASE_OUT }}>
            <motion.p
              className="absolute inset-x-3 top-[9%] m-0 flex flex-col items-center gap-1.5 text-center"
              initial={false}
              animate={{ scale: size }}
              transition={{ duration: DUR.short, ease: EASE_OUT }}
            >
              <span className="rounded-md bg-viewer px-2 py-1 type-section font-bold text-balance text-viewer-ink">{TITLE.text}</span>
            </motion.p>
          </motion.div>
          {caption ? (
            <p aria-hidden className="absolute inset-x-3 bottom-[8%] m-0 flex flex-wrap justify-center gap-x-1 rounded-md bg-viewer px-1.5 py-1 text-center type-label-sm">
              {caption.line.map((word, i) => (
                <span key={word.start} className={cn('rounded-sm px-0.5', i === caption.word ? 'bg-viewer-rule text-viewer-ink' : 'text-viewer-ink-2')}>
                  {word.text}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <figcaption className="type-meta text-ink-2">The preview at the playhead, with the title and captions you set.</figcaption>
      </figure>
    </MotionConfig>
  );
}

export function GraphicValues({
  size,
  place,
  onSize,
  onPlace,
  onReset,
}: {
  readonly size: number;
  readonly place: Place;
  readonly onSize: (size: number) => void;
  readonly onPlace: (place: Place) => void;
  readonly onReset: () => void;
}) {
  const id = useId();
  const changed = size !== TITLE.size || place !== TITLE.place;
  const Values = SHOWCASE_ICONS.values;
  const Undo = SHOWCASE_ICONS.undo;
  return (
    <section aria-labelledby={`${id}-t`} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <Values aria-hidden className="size-5 text-ink-3" />
        <h4 id={`${id}-t`} className="m-0 me-1 type-section text-ink">
          Title card
        </h4>
        {changed ? (
          <Chip tone="you">You changed this</Chip>
        ) : (
          <Chip tone="ai">
            <AiMark />
            Designed by the AI
          </Chip>
        )}
      </header>
      <p className="m-0 max-w-prose type-body text-ink-2">The AI designed this title for your video. Its values are yours to change; the design stays.</p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${id}-size`} className="type-label text-ink">
            Size
          </label>
          <output htmlFor={`${id}-size`} className="tc-mono type-meta text-ink-2">
            {size.toFixed(2)}×
          </output>
        </div>
        <input
          id={`${id}-size`}
          type="range"
          min={SIZE_RANGE.min}
          max={SIZE_RANGE.max}
          step={SIZE_RANGE.step}
          value={size}
          onChange={(event) => onSize(Number(event.target.value))}
          className="h-6 w-full max-w-sm cursor-pointer accent-ink"
        />
      </div>
      <div className="flex flex-col gap-2">
        <span aria-hidden className="type-label text-ink">
          Place
        </span>
        <Segmented label="Place" options={PLACES} value={place} onChange={onPlace} />
      </div>
      {changed ? (
        <button type="button" className={buttonClasses('quiet', 'md', '-ms-3 w-fit')} onClick={onReset}>
          <Undo aria-hidden className="size-4" />
          Back to the AI’s values
        </button>
      ) : null}
    </section>
  );
}
