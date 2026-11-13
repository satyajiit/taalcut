// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the rhythm bed (a template's overview) and the seconds ruler · system: DESIGN.md
 *   v0.7 · the rhythm on a sunken bed: waveform, slots, text marks and a seconds ruler share one time axis. The
 *   breakdown that used to sit under it is the review now (template-review.tsx, BRK1)
 * states: the strip's (slot-strip.tsx); the lit slot's stretch of sound in the beat's strong tone
 * accents: rose (rhythm) and marigold (selection) on the bed, the slot roles' data marks (UX3: kinds)
 */
import { useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { cn } from '#lib/cn';
import { BeatWaveform } from './beat-waveform';
import { OverlaysLane } from './overlays-lane';
import { SlotStrip } from './slot-strip';
import { toSeconds } from './slot-words';

export interface RhythmBedProps {
  template: Template;
  selected: number;
  onSelect: (index: number) => void;
  /** The slot under the pointer; null when it leaves. Its stretch of the waveform lights. */
  hovered: number | null;
  onHover: (index: number | null) => void;
  onRename?: ((index: number) => void) | undefined;
  onDrop?: ((index: number) => void) | undefined;
  compact?: boolean;
}

/**
 * The template as its reel was read, on one time axis: the waveform with its beats, the slots under it (the lit
 * one's stretch of sound highlighted), the on-screen text's marks and a seconds ruler, on the sunken bed. The
 * breakdown's top half, and a template's overview (UX4 tpl), where it must survive (research §5).
 */
export function RhythmBed({
  template,
  selected,
  onSelect,
  hovered,
  onHover,
  onRename,
  onDrop,
  compact = false,
}: RhythmBedProps) {
  const lit = template.slots[hovered ?? selected] ?? template.slots[0]!;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-sunken p-3" data-slot="rhythm-bed">
      <BeatWaveform
        template={template}
        highlight={{ start: toSeconds(lit.start), end: toSeconds(lit.start) + toSeconds(lit.duration) }}
        className={compact ? 'h-10' : 'h-14'}
      />
      <SlotStrip
        template={template}
        selected={selected}
        onSelect={onSelect}
        onHover={onHover}
        {...(onRename ? { onRename } : {})}
        {...(onDrop ? { onDrop } : {})}
        className={compact ? 'h-12' : undefined}
      />
      <OverlaysLane template={template} litSlot={lit.id} show="marks" />
      <Ruler total={toSeconds(template.duration)} />
    </div>
  );
}

/** Second marks under the strip: every 5 s on a reel, every second on a short one. */
export function Ruler({ total }: { total: number }) {
  const { i18n } = useLingui();
  const step = total > 12 ? 5 : total > 4 ? 2 : 1;
  const marks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <div aria-hidden className="relative h-4 type-caption text-ink-3 tabular-nums">
      {marks.map((second) => (
        <span
          key={second}
          // One line: Hindi's narrow unit has a space ("15 से"), and the last mark has no room to its right.
          className={cn(
            'absolute top-0 whitespace-nowrap',
            second > 0 && '-translate-x-1/2',
            second >= total - 0.5 && '-translate-x-full',
          )}
          style={{ left: `${(second / total) * 100}%` }}
        >
          {i18n.number(second, { style: 'unit', unit: 'second', unitDisplay: 'narrow' })}
        </span>
      ))}
    </div>
  );
}
