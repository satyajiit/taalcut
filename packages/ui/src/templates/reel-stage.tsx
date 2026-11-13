// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the reel on its stage (BRK1-REV) · system: DESIGN.md v0.7 (footage first: the
 *   viewer grey in both themes, the reel at its own shape, never cropped or stretched)
 * the kept reel playing with its music, as large as its cell lets it be, portrait or landscape; under it Play or
 *   Pause, whether the selected slot loops, and where the playhead is. Over the footage only what acts on it: the box
 *   of the text the panel points at, dashed
 * states: loading (the grey, then the first frame) · playing · paused · looping (the slot plays round) · no reel (the
 *   slot's frame from the contact sheet and one line on why it can't play) · failed (the same line: the file is
 *   gone or refused)
 * motion: none of the app's; the reel moves. Reduced motion: picking a slot never starts it playing
 */
import { useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { REVIEW_ICONS } from './review-icons';
import { sheetTileFill } from './sheet-tile';
import { toSeconds } from './slot-words';
import type { ReelPlayer } from './use-reel-player';
import { useShortcutFormat } from '../palette/key-words';

export interface ReelStageProps {
  template: Template;
  reelUrl: string | null;
  sheetUrl: string | null;
  player: ReelPlayer;
  selected: number;
  looping: boolean;
  onLooping: (looping: boolean) => void;
  /** The text overlay whose box to draw over the reel. */
  litText: Template['text'][number]['id'] | null;
  className?: string;
}

/** Where the playhead is, in seconds to two places: text that changes in place, so mono (DESIGN: Mono). */
function Clock({ player, total }: { player: ReelPlayer; total: number }) {
  const { i18n } = useLingui();
  const span = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const format = (seconds: number) =>
      i18n.number(seconds, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return player.subscribe((seconds) => {
      if (span.current) span.current.textContent = format(Math.min(total, Math.max(0, seconds)));
    });
  }, [player, total, i18n]);
  const whole = i18n.number(total, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: 2,
  });
  return (
    <span aria-hidden className="tc-mono type-meta text-ink-2 tabular-nums">
      <span ref={span} /> / {whole}
    </span>
  );
}

export function ReelStage({
  template,
  reelUrl,
  sheetUrl,
  player,
  selected,
  looping,
  onLooping,
  litText,
  className,
}: ReelStageProps) {
  const { t, i18n } = useLingui();
  const keys = useShortcutFormat();
  const [missing, setMissing] = useState(false);
  const ratio = `${template.canvas.width} / ${template.canvas.height}`;
  const slot = template.slots[selected] ?? template.slots[0]!;
  const sheet = template.contactSheet;
  const tile = sheet ? (slot.frame ?? sheet.frames.findIndex((f) => f.slotId === slot.id)) : -1;
  const playable = Boolean(reelUrl) && !player.failed && !missing;
  const text = litText ? template.text.find((item) => item.id === litText) : undefined;
  const number = i18n.number(selected + 1);
  const Play = player.playing ? REVIEW_ICONS.pause : REVIEW_ICONS.play;

  useEffect(() => setMissing(false), [reelUrl]);

  // The reel at its own shape inside the cell: as wide as fits, as tall as fits (container units on a size container).
  const box: CSSProperties = {
    aspectRatio: ratio,
    width: `min(100cqw, calc(100cqh * ${template.canvas.width} / ${template.canvas.height}))`,
  };
  return (
    <div data-slot="reel-stage" className={cn('flex min-h-0 flex-col gap-2', className)}>
      <div className="tc-viewer grid min-h-0 flex-1 place-items-center rounded-xl p-3 [container-type:size]">
        <div className="relative overflow-hidden rounded-md bg-viewer" style={box}>
          {reelUrl ? (
            <video
              ref={player.attach}
              src={reelUrl}
              playsInline
              preload="auto"
              aria-label={t`The reel`}
              onError={() => setMissing(true)}
              className={cn('block size-full object-contain', !playable && 'hidden')}
            />
          ) : null}
          {!playable && sheet && tile >= 0 ? (
            <span
              aria-hidden
              className="absolute inset-0 bg-no-repeat"
              style={sheetTileFill(sheet, sheetUrl, tile)}
            />
          ) : null}
          {/* Always there, shown only while a line is lit: a lit line goes dark on blur, and a node removed then
              would make the sheet's focus trap take focus back mid-Tab (Radix's FocusScope watches removals). */}
          <span
            aria-hidden
            data-slot="text-box"
            hidden={!text}
            className="pointer-events-none absolute rounded-sm border-2 border-dashed border-viewer-ink"
            style={
              text
                ? {
                    left: `${text.box.x * 100}%`,
                    top: `${text.box.y * 100}%`,
                    width: `${text.box.width * 100}%`,
                    height: `${text.box.height * 100}%`,
                  }
                : undefined
            }
          />
        </div>
      </div>
      {playable ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Button
            size="sm"
            variant="secondary"
            icon={Play}
            aria-keyshortcuts={keys.aria('space')}
            onClick={() => player.toggle()}
            disabled={!player.ready}
          >
            {player.playing ? t`Pause` : t`Play`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={REVIEW_ICONS.loop}
            aria-pressed={looping}
            onClick={() => onLooping(!looping)}
            className={cn(looping && 'bg-selected text-ink hover:bg-selected')}
          >
            {t`Loop slot ${number}`}
          </Button>
          <span className="ms-auto">
            <Clock player={player} total={toSeconds(template.duration)} />
          </span>
        </div>
      ) : (
        <p data-slot="reel-missing" className="m-0 type-meta text-ink-2">
          {reelUrl
            ? t`The reel’s file can’t be read, so it can’t play here. Its frames still show.`
            : t`This template doesn’t keep its reel, so it can’t play here. Its frames still show.`}
        </p>
      )}
    </div>
  );
}
