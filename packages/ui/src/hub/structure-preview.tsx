// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: StructurePreview (U6) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a template's structure without any media, for hub rows and detail, Share, starters and
 *   formats: `strip` (blocks on a beat lane; hover or focus plays the first 3 s) or `frame` (a 9:16 frame playing the
 *   slots in time, the strip under it). role="img" with the label and a summary ("8 slots, 30s, cuts on the
 *   beat"); "Describe slots" lists them as text. No img, video or URL anywhere in its DOM.
 * states: still · playing · paused off screen or with the window hidden · reduced motion (a still of slot 1 and the
 *   strip) · Describe slots: default · hover (ink) · focus-visible (base ring) · active · open; n/a: disabled,
 *   loading, error, success (it draws what it is given)
 * motion: one clock (use-structure-clock.ts) that renders at the cuts, beats and captions only; the playhead and
 *   the camera move run between them as Web Animations on transform (UX4 B18: no React render per frame); colours
 *   are tokens in the DOM, so a theme change redraws them
 */
import { useLingui } from '@lingui/react/macro';
import type { HubStructure } from '@taalcut/core';
import { ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useId, useMemo, useRef, useState } from 'react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { slotLine, structureSummary } from './preview-words';
import { previewOfStrip, previewOfStructure, slotAt, type HubStrip, type PreviewModel } from './structure-of';
import { StructureFrame } from './structure-frame';
import { StructureStrip } from './structure-strip';
import { useStructureClock } from './use-structure-clock';

/** A list row's hover plays this much of the start. */
export const STRIP_PREVIEW_SECONDS = 3;

interface PreviewCommon {
  /** strip: slot blocks on a beat lane; frame: a 9:16 frame playing the slots, the strip under it. */
  readonly mode: 'strip' | 'frame';
  /** Plays when true. A strip also plays the first 3 s while the pointer is on it. */
  readonly playing?: boolean;
  /** The accessible name, translated. */
  readonly label: string;
  /** The "Describe slots" disclosure; on by default in frame mode. */
  readonly describe?: boolean;
  /** A strip's look: neutral blocks on the page (default), or a storyboard on the viewer grey (Start from…). */
  readonly look?: 'plate' | 'viewer';
  readonly className?: string;
}

/**
 * When what is drawn changes: the cuts, and in a frame the beats the ticker lights and the captions' comings and
 * goings. The clock renders at these alone.
 */
function marksOf(model: PreviewModel, mode: 'strip' | 'frame'): number[] {
  const cuts = model.slots.map((slot) => slot.start);
  if (mode === 'strip') return cuts;
  const captions = model.overlays.flatMap((overlay) => [overlay.start, overlay.start + overlay.duration]);
  return [...cuts, ...model.beats, ...captions];
}

export type StructurePreviewProps = PreviewCommon &
  (
    | { readonly structure: HubStructure; readonly strip?: undefined }
    | { readonly strip: HubStrip; readonly structure?: undefined }
  );

export function StructurePreview(props: StructurePreviewProps) {
  const { mode, playing = false, label, className } = props;
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const reduced = useReducedMotion() ?? false;
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const { structure, strip } = props;
  const model = useMemo(
    () => (structure ? previewOfStructure(structure) : strip ? previewOfStrip(strip) : null),
    [structure, strip],
  );
  const loop =
    mode === 'strip' ? Math.min(STRIP_PREVIEW_SECONDS, model?.duration ?? 0) : (model?.duration ?? 0);
  const active = playing || (mode === 'strip' && hovered);
  const marks = useMemo(() => (model ? marksOf(model, mode) : []), [model, mode]);
  const clock = useStructureClock(root, { loop, playing: active, rewind: mode === 'strip', reduced, marks });
  const { time } = clock;
  if (!model) return null;
  const current = slotAt(model, time);
  const summary = structureSummary(i18n, model, format);
  const describe = props.describe ?? mode === 'frame';
  const words = model.slots.some((slot) => slot.words !== null);

  return (
    <div
      ref={root}
      data-slot="structure-preview"
      data-mode={mode}
      data-playing={active && !reduced ? '' : undefined}
      data-current-slot={current}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      <div
        role="img"
        aria-label={t`${label}: ${summary}`}
        onPointerEnter={mode === 'strip' ? () => setHovered(true) : undefined}
        onPointerLeave={mode === 'strip' ? () => setHovered(false) : undefined}
        className="flex flex-col gap-2"
      >
        {mode === 'frame' ? (
          <StructureFrame model={model} time={time} current={current} reduced={reduced} clock={clock} />
        ) : null}
        <StructureStrip
          model={model}
          time={active && !reduced ? time : null}
          current={active && !reduced ? current : null}
          clock={clock}
          loop={loop}
          look={props.look ?? 'plate'}
        />
      </div>
      {describe ? (
        <details className="group text-sm text-ink-2">
          <summary
            aria-controls={listId}
            className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-0.5 hover:text-ink active:text-ink-3 [&::-webkit-details-marker]:hidden"
          >
            <ChevronRight
              aria-hidden
              className="size-3.5 transition-transform duration-(--dur-micro) group-open:rotate-90"
            />
            {t`Describe slots`}
          </summary>
          <ol id={listId} className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {model.slots.map((slot) => (
              <li key={slot.index} className="flex flex-col">
                <span className="text-ink tabular-nums">{slotLine(i18n, slot, format)}</span>
                {words && slot.words ? (
                  <UserContent translate="no" className="text-ink-2">
                    {slot.words}
                  </UserContent>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
