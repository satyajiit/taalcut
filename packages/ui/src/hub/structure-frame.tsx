// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: structure frame (U6 frame mode) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (footage and previews on the viewer grey; rose = beats; marigold = the playhead) · a 9:16
 *   frame playing the slots in time with no media: each slot a neutral block (its number and camera glyph on top;
 *   at its centre the shot's glyph drawn large, what the slot is for, the shot and camera in words and how long it
 *   runs: UX1, the frame is never an empty box; the intent in the author's words at the foot), text boxes as
 *   rounded placeholder bars, a rose beat ticker
 * states: playing · paused (keeps its place) · reduced motion (a still of slot 1) · n/a: interactive states belong
 *   to the page's Play control
 * motion: the parent's one clock, which renders at the cuts, beats and captions only (UX4 B18): the camera move is
 *   one Web Animation on the block's transform per slot and the playhead one over the loop (the compositor runs
 *   both); a dissolve or fade is a 150 ms opacity fade, everything else a cut; reduced motion: none of it
 */
import { useLingui } from '@lingui/react/macro';
import { motion } from 'motion/react';
import { useRef } from 'react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { REDUCED_FADE } from '#lib/motion';
import { UserContent } from '../cards/card-frame';
import { MOTION_LABELS, ROLE_LABELS, SHOT_TYPE_LABELS } from '../templates/slot-words';
import {
  cameraFrames,
  cameraTransform,
  MOTION_GLYPHS,
  SHOT_GLYPHS,
  SHOT_TONES,
  VIEWER_INK,
  VIEWER_INK_2,
} from './preview-glyphs';
import { OVERLAY_WORDS } from './preview-words';
import type { PreviewModel } from './structure-of';
import { ClockPlayhead } from './structure-strip';
import { STILL_CLOCK, useClockAnimation, type StructureClock } from './use-structure-clock';

export interface StructureFrameProps {
  readonly model: PreviewModel;
  readonly time: number;
  readonly current: number;
  readonly reduced: boolean;
  /** The preview's clock: the camera's move and the playhead run on it between cuts. */
  readonly clock?: StructureClock | undefined;
  readonly className?: string;
}

/** Which beat the clock is on (the ticker lights it), or -1 before the first. */
function beatAt(beats: readonly number[], time: number): number {
  let found = -1;
  for (let i = 0; i < beats.length; i += 1) if ((beats[i] ?? Infinity) <= time + 1e-6) found = i;
  return found;
}

export function StructureFrame({ model, time, current, reduced, clock, className }: StructureFrameProps) {
  const { i18n } = useLingui();
  const format = useFormatters();
  const slot = model.slots[current];
  const block = useRef<HTMLSpanElement>(null);
  // The camera's move over the whole slot, placed where the clock is in it; under reduced motion the block holds.
  useClockAnimation(
    block,
    clock && slot && !reduced ? cameraFrames(slot.motion) : null,
    `${current}:${slot?.motion ?? ''}:${slot?.start ?? 0}`,
    {
      clock: clock ?? STILL_CLOCK,
      duration: (slot?.duration ?? 0) * 1000,
      at: () => (clock && slot ? (clock.now() - slot.start) * 1000 : 0),
    },
  );
  const total = model.duration || 1;
  const progress = slot && slot.duration > 0 ? (time - slot.start) / slot.duration : 0;
  const ShotGlyph = slot?.shotType ? SHOT_GLYPHS[slot.shotType] : null;
  const MotionGlyph = slot?.motion ? MOTION_GLYPHS[slot.motion] : null;
  // The shot and the camera in words, under what the slot is for: they wrap there, never cut off.
  const shot = [
    slot?.shotType ? i18n._(SHOT_TYPE_LABELS[slot.shotType]) : null,
    slot?.motion ? i18n._(MOTION_LABELS[slot.motion]) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const overlays = model.overlays.filter(
    (overlay) => overlay.start <= time + 1e-6 && time < overlay.start + overlay.duration,
  );
  const beat = beatAt(model.beats, time);
  return (
    <div
      aria-hidden
      data-slot="structure-frame"
      className={cn('tc-viewer relative aspect-[9/16] w-full overflow-hidden rounded-xl', className)}
    >
      {slot ? (
        <motion.div
          key={slot.index}
          data-frame-slot={slot.index}
          initial={{ opacity: slot.enter === 'fade' && !reduced ? 0 : 1 }}
          animate={{ opacity: 1 }}
          transition={{ duration: REDUCED_FADE }}
          className="absolute inset-0"
        >
          <span
            ref={block}
            className={cn('absolute inset-2 block rounded-lg', SHOT_TONES[slot.shotType ?? 'none'])}
            style={{ transform: reduced ? undefined : cameraTransform(slot.motion, progress) }}
          />
          <span className={cn('absolute inset-x-4 top-4 flex items-center gap-2', VIEWER_INK)}>
            <span className="text-2xl font-semibold tabular-nums">{i18n.number(slot.index + 1)}</span>
            {MotionGlyph ? <MotionGlyph className="size-4 shrink-0" /> : null}
          </span>
          <span
            data-slot="frame-centre"
            className={cn(
              'absolute inset-x-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 text-center',
              VIEWER_INK,
            )}
          >
            {ShotGlyph ? <ShotGlyph strokeWidth={1.25} className={cn('mb-1 size-12', VIEWER_INK_2)} /> : null}
            {slot.role ? (
              <span className="text-md font-semibold">{i18n._(ROLE_LABELS[slot.role])}</span>
            ) : null}
            {shot ? <span className={cn('text-xs leading-snug', VIEWER_INK_2)}>{shot}</span> : null}
            <span className={cn('text-xs tabular-nums', VIEWER_INK_2)}>
              {format.duration(slot.duration * 1000)}
            </span>
          </span>
          {slot.words ? (
            <UserContent
              translate="no"
              className={cn('absolute inset-x-4 bottom-10 line-clamp-4 text-sm leading-snug', VIEWER_INK)}
            >
              {slot.words}
            </UserContent>
          ) : null}
        </motion.div>
      ) : null}
      {overlays.map((overlay, index) => (
        <span
          key={`${overlay.role}-${overlay.start}-${index}`}
          data-overlay-role={overlay.role}
          className="absolute flex items-center"
          style={{
            left: `${overlay.box.x * 100}%`,
            top: `${overlay.box.y * 100}%`,
            width: `${overlay.box.width * 100}%`,
            height: `${overlay.box.height * 100}%`,
            justifyContent: 'center',
          }}
        >
          <span
            className={cn(
              'flex h-full max-h-7 min-h-5 items-center justify-center rounded-md border border-viewer-rule bg-viewer/85 px-2 text-xs font-medium',
              VIEWER_INK,
            )}
            // As long as the words were: about one character in four of the box per character, within it.
            style={{ width: `${Math.min(100, Math.max(28, overlay.chars * 2.4))}%` }}
          >
            {i18n._(OVERLAY_WORDS[overlay.role])}
          </span>
        </span>
      ))}
      <span className="absolute inset-x-3 bottom-3 block h-3">
        {model.beats.map((at, index) => (
          <span
            key={index}
            data-beat={index}
            className={cn(
              'absolute bottom-0 h-3 w-px origin-bottom rounded-full bg-beat transition-[opacity,transform] duration-(--dur-micro)',
              index === beat ? 'opacity-100' : 'scale-y-50 opacity-60',
            )}
            style={{ left: `${(at / total) * 100}%` }}
          />
        ))}
        <ClockPlayhead
          time={time}
          total={total}
          loop={total}
          clock={reduced ? undefined : clock}
          slot="frame-playhead"
          className="absolute inset-y-0 left-0 w-full"
        >
          <span className="absolute inset-y-[-2px] right-0 w-0.5 translate-x-1/2 rounded-full bg-playhead" />
        </ClockPlayhead>
      </span>
    </div>
  );
}
