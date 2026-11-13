// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: graphic timing · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * when a motion graphic shows: its start and length in timecode, and Earlier and Later by a frame or a beat
 *   (graphics.edit with a time anchor); each is one ⌘Z. A designed graphic places itself (HFW1)
 * states: default · hover/active/focus-visible (Button) · disabled (no app actions, the graphic is gone, Earlier at
 *   the very start) · loading (the control whose move is on its way) · error (the cause under the row) · success
 *   (the new time shows)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { RationalTime, TaalcutError } from '@taalcut/core';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '#components/button';
import { useTimecode } from '../make/timecode';
import { MediaError } from './media-lines';

export interface GraphicTimingProps {
  start: RationalTime;
  duration: RationalTime;
  /** One beat in the start's frames. */
  beat: number;
  disabled: boolean;
  busy: string | null;
  error: { readonly key: string; readonly error: TaalcutError } | null;
  /** Moves the start to `frame` (the start's rate). */
  onMove: (key: string, frame: number) => void;
}

const MOVE_KEYS = ['frameEarlier', 'frameLater', 'beatEarlier', 'beatLater'] as const;

export function GraphicTiming(props: GraphicTimingProps) {
  const { start, duration, beat, disabled, busy, error, onMove } = props;
  const { t } = useLingui();
  const time = useTimecode();
  const at = start.value;
  const startWords = time.clock(at, start.rate, { fraction: true });
  const lengthWords = time.length(duration.value, duration.rate);
  const moves = [
    { key: 'frameEarlier', to: at - 1, label: t`A frame earlier`, icon: <ChevronLeft aria-hidden /> },
    { key: 'frameLater', to: at + 1, label: t`A frame later`, icon: <ChevronRight aria-hidden /> },
    { key: 'beatEarlier', to: at - beat, label: t`A beat earlier`, icon: <ChevronsLeft aria-hidden /> },
    { key: 'beatLater', to: at + beat, label: t`A beat later`, icon: <ChevronsRight aria-hidden /> },
  ] as const;
  const moveError = error && (MOVE_KEYS as readonly string[]).includes(error.key) ? error.error : null;

  return (
    <div data-slot="graphic-timing" className="flex flex-col gap-3">
      <p className="m-0 text-sm text-ink-2 tabular-nums">{t`Starts at ${startWords} · lasts ${lengthWords}`}</p>
      <div role="group" aria-label={t`Move it`} className="flex flex-wrap gap-1.5">
        {moves.map((move) => (
          <Button
            key={move.key}
            size="sm"
            variant="secondary"
            disabled={disabled || move.to < 0}
            loading={busy === move.key}
            onClick={() => onMove(move.key, move.to)}
          >
            {move.icon}
            {move.label}
          </Button>
        ))}
      </div>
      {moveError ? <MediaError error={moveError} /> : null}
    </div>
  );
}
