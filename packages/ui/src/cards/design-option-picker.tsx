// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design option picker (DSG2) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the designs a graphic came with, side by side: each a still of it over the person's own
 *   video on the viewer grey (the canvas's shape), its number, its name and its idea in one line (the model's
 *   words, shown as content). The one in the video carries the accent ring, the soft accent ground and the words
 *   "In your video" (never colour alone). One click on another swaps it in (graphics.chooseOption, one ⌘Z).
 * layout: by its own width, never the window's: a column of rows (still left, words right) in a narrow column
 *   such as the editor's chat, three columns (still above its words) from 28rem
 * states: default · hover · focus-visible · active · in use (pressed) · choosing (that tile busy, the others off) ·
 *   disabled (no command bus, a deleted video) · no still (the viewer grey)
 * keyboard: each tile is a button (Tab, then Enter or Space); a screen reader hears "Design 2 of 3", the name, the
 *   idea, and whether it is pressed
 * motion: the still fades in once loaded; nothing else moves · pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { CircleCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '#lib/cn';
import { UserContent } from './card-frame';

/** One design as a tile shows it. */
export interface DesignOptionView {
  readonly compositionId: string;
  /** The design's name, as the model wrote it. */
  readonly name: string;
  /** What it goes for, in the model's one line. */
  readonly idea: string;
  /** A still of it over the video (a URL the CSP allows); null keeps the viewer grey. */
  readonly still: string | null;
  readonly inUse: boolean;
}

export interface DesignOptionPickerProps {
  readonly options: readonly DesignOptionView[];
  /** The canvas's width over its height (9:16 is 0.5625). */
  readonly aspect: number;
  /** True leaves the tiles as a record: nothing to press. */
  readonly disabled: boolean;
  /** The design being swapped in now, by its composition. */
  readonly busy: string | null;
  readonly onChoose: (compositionId: string) => void;
  readonly className?: string;
}

/** A still on the viewer grey in the canvas's shape; it fades in once it has loaded. */
function OptionStill({ url, aspect, dimmed }: { url: string | null; aspect: number; dimmed: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const portrait = aspect < 1;
  return (
    <span
      data-slot="design-option-still"
      style={{ aspectRatio: String(aspect) }}
      className={cn(
        'tc-viewer relative block shrink-0 overflow-hidden rounded-md transition-opacity duration-(--dur-short) ease-(--ease-out)',
        portrait ? 'w-16 @md:w-full @md:max-w-36' : 'w-28 @md:w-full',
        dimmed && 'opacity-50',
      )}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setShown(url)}
          className={cn(
            'absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-(--dur-micro) ease-(--ease-out)',
            shown === url && 'opacity-100',
          )}
        />
      ) : null}
    </span>
  );
}

/** The designs to choose between: one click swaps another in. */
export function DesignOptionPicker({
  options,
  aspect,
  disabled,
  busy,
  onChoose,
  className,
}: DesignOptionPickerProps) {
  const { t, i18n } = useLingui();
  const base = useId();
  const count = i18n.number(options.length);
  return (
    <div
      role="group"
      data-slot="design-options"
      aria-label={t`Designs to choose from`}
      className={cn('grid grid-cols-1 gap-1.5 @md:grid-cols-3 @md:gap-2', className)}
    >
      {options.map((option, index) => {
        const number = i18n.number(index + 1);
        const choosing = busy === option.compositionId;
        const nameId = `${base}-name-${index}`;
        const ideaId = `${base}-idea-${index}`;
        return (
          <button
            key={option.compositionId}
            type="button"
            data-slot="design-option"
            data-in-use={option.inUse ? '' : undefined}
            aria-pressed={option.inUse}
            aria-labelledby={nameId}
            aria-describedby={ideaId}
            aria-busy={choosing || undefined}
            disabled={disabled || (busy !== null && !choosing)}
            onClick={() => {
              if (!option.inUse && busy === null) onChoose(option.compositionId);
            }}
            className={cn(
              // Focus comes from base.css (:focus-visible, instant, never animated), as the kit's buttons.
              'flex min-w-0 cursor-pointer items-start gap-3 rounded-lg p-1.5 text-start transition-colors duration-(--dur-micro) ease-(--ease-out) disabled:cursor-default @md:flex-col @md:gap-2',
              option.inUse
                ? 'bg-primary-soft ring-1 ring-primary-strong ring-inset'
                : 'hover:bg-hover active:bg-pressed disabled:hover:bg-transparent',
            )}
          >
            <OptionStill url={option.still} aspect={aspect} dimmed={choosing} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 @md:w-full @md:flex-none">
              <span className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                <span aria-hidden className="mr-1.5 text-ink-3 tabular-nums">
                  {number}
                </span>
                <span id={nameId}>
                  <span className="sr-only">{t`Design ${number} of ${count}:`}</span>{' '}
                  <UserContent translate="no">{option.name}</UserContent>
                </span>
              </span>
              <UserContent id={ideaId} translate="no" className="text-sm text-ink-2 [overflow-wrap:anywhere]">
                {option.idea}
              </UserContent>
              {option.inUse ? (
                <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-primary-strong">
                  <CircleCheck aria-hidden className="size-3.5 shrink-0" />
                  {t`In your video`}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
