// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the review's time axis (BRK1-REV) · system: DESIGN.md v0.7 (rose is rhythm,
 *   marigold the playhead and the selection)
 * one axis under the reel: the sound with its beats, the slots with the reel's own frames in them, the text's
 *   marks, the cuts you can move, a seconds ruler, and the playhead across all of them. A press on the sound or the
 *   ruler moves the playhead there
 * states: the strip's (slot-strip.tsx) and the cuts' (cut-handles.tsx) · playing (the playhead moves by a transform
 *   from the reel's clock, every frame, never through React) · no reel (the playhead stays at the selected slot's
 *   start) · read-only (no grips)
 * motion: the playhead tracks the reel as it plays; nothing else moves on its own. Reduced motion: the same (it is
 *   the reel's position, not decoration)
 */
import { useLingui } from '@lingui/react/macro';
import type { Id, Template } from '@taalcut/core';
import { useEffect, useRef, type PointerEvent } from 'react';
import { cn } from '#lib/cn';
import { BeatWaveform } from './beat-waveform';
import { Ruler } from './breakdown-view';
import { CutHandles } from './cut-handles';
import type { CutPlace } from './cut-math';
import { SlotStrip } from './slot-strip';
import { toSeconds } from './slot-words';
import type { ReelPlayer } from './use-reel-player';

export interface ReviewTimelineProps {
  template: Template;
  sheetUrl: string | null;
  selected: number;
  onSelect: (index: number) => void;
  player: ReelPlayer;
  toCheck: ReadonlySet<Id<'TemplateSlot'>>;
  unsureCuts: ReadonlySet<Id<'TemplateSlot'>>;
  /** The text overlay the panel points at: its mark is lit. */
  litText: Id<'TextOverlay'> | null;
  onSeek: (seconds: number) => void;
  onCutPreview: (seconds: number | null) => void;
  onMoveCut?: ((slotId: Id<'TemplateSlot'>, place: CutPlace) => void) | undefined;
  onRename?: ((index: number) => void) | undefined;
  onDrop?: ((index: number) => void) | undefined;
}

/** The playhead: a marigold line moved by the reel's clock, as a transform, on every frame while it plays. */
function Playhead({ player, total }: { player: ReelPlayer; total: number }) {
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = line.current;
    const track = el?.parentElement;
    if (!el || !track) return;
    let width = track.clientWidth;
    let last = 0;
    const place = (seconds: number) => {
      last = seconds;
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS transform, never UI copy
      el.style.transform = `translate3d(${(Math.min(total, Math.max(0, seconds)) / total) * width}px, 0, 0)`;
    };
    const observer = new ResizeObserver(() => {
      width = track.clientWidth;
      place(last);
    });
    observer.observe(track);
    const stop = player.subscribe(place);
    return () => {
      stop();
      observer.disconnect();
    };
  }, [player, total]);
  return (
    <div
      ref={line}
      aria-hidden
      data-slot="playhead"
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-3 w-0.5 -translate-x-px rounded-pill bg-playhead-strong will-change-transform"
    />
  );
}

/** The text on screen as marks on the axis; text Taalcut doubts is dashed, the one the panel names is lit. */
function TextMarks({ template, lit }: { template: Template; lit: Id<'TextOverlay'> | null }) {
  const total = toSeconds(template.duration) || 1;
  if (template.text.length === 0) return null;
  return (
    <div aria-hidden data-slot="text-marks" className="relative h-1.5">
      {template.text.map((item) => (
        <span
          key={item.id}
          data-doubted={(item.doubts?.length ?? 0) > 0 || undefined}
          className={cn(
            'absolute top-0 h-1.5 rounded-pill transition-colors duration-(--dur-micro) ease-(--ease-out)',
            item.id === lit
              ? 'bg-ink'
              : (item.doubts?.length ?? 0) > 0
                ? 'border border-dashed border-warning-strong bg-raised'
                : 'bg-rule-strong',
          )}
          style={{
            left: `${(toSeconds(item.start) / total) * 100}%`,
            width: `max(0.375rem, ${(toSeconds(item.duration) / total) * 100}%)`,
          }}
        />
      ))}
    </div>
  );
}

export function ReviewTimeline({
  template,
  sheetUrl,
  selected,
  onSelect,
  player,
  toCheck,
  unsureCuts,
  litText,
  onSeek,
  onCutPreview,
  onMoveCut,
  onRename,
  onDrop,
}: ReviewTimelineProps) {
  const { t } = useLingui();
  const total = toSeconds(template.duration) || 1;
  const slot = template.slots[selected] ?? template.slots[0]!;
  const seekAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - box.left) / box.width) * total);
  };
  return (
    <div
      data-slot="review-timeline"
      role="group"
      aria-label={t`The reel’s time`}
      className="flex flex-col gap-1.5 rounded-xl bg-sunken px-3 pt-3 pb-2 [@media(max-height:42rem)]:pt-2"
    >
      <div className="relative flex flex-col gap-1.5">
        <div onPointerDown={seekAt} className="cursor-text">
          <BeatWaveform
            template={template}
            highlight={{
              start: toSeconds(slot.start),
              end: toSeconds(slot.start) + toSeconds(slot.duration),
            }}
            className="h-10 [@media(max-height:42rem)]:h-7"
          />
        </div>
        <div className="relative">
          <SlotStrip
            template={template}
            selected={selected}
            onSelect={onSelect}
            frames={sheetUrl}
            toCheck={toCheck}
            {...(onRename ? { onRename } : {})}
            {...(onDrop ? { onDrop } : {})}
            className="h-14 [@media(max-height:42rem)]:h-11"
          />
          <CutHandles
            template={template}
            selected={selected}
            unsure={unsureCuts}
            onPreview={onCutPreview}
            onMove={(slotId, place) => onMoveCut?.(slotId, place)}
            disabled={!onMoveCut}
          />
        </div>
        <TextMarks template={template} lit={litText} />
        <Playhead player={player} total={total} />
      </div>
      <div onPointerDown={seekAt} className="cursor-text">
        <Ruler total={total} />
      </div>
    </div>
  );
}
