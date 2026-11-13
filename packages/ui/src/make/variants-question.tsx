// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: variants question · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (Decision cards: raised, hairline all round, xl radius, no shadow, title 700) · the run's
 *   one question (R11): how many videos to make, a 1–10 stepper at the agent's suggestion, the answer as the primary
 * states: default · hover/active (the stepper's buttons and the primary) · focus (base ring; the number is a
 *   spinbutton: arrows, Page Up/Down, Home, End) · disabled (− at 1, + at 10; everything once answered or when the
 *   run ended) · loading (the primary while the answer goes) · error (the caller's toast; the card stays) · success
 *   (settles in place: "Making 3 videos…" with the AI's running mark until the board arrives)
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { Plural, useLingui } from '@lingui/react/macro';
import { Minus, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '#components/button';
import { StatusMark } from '../chat/status-mark';
import { CardFrame } from '../cards/card-frame';

export interface VariantsQuestionProps {
  suggested: number;
  slotCount: number;
  /** Sends the answer; resolves once it is on its way. Absent: the question can't be answered here. */
  onAnswer?: (count: number) => void | Promise<void>;
  /** The run ended before an answer. */
  expired?: boolean;
}

const MIN = 1;
const MAX = 10;

export function VariantsQuestion({ suggested, slotCount, onAnswer, expired = false }: VariantsQuestionProps) {
  const { t, i18n } = useLingui();
  const [count, setCount] = useState(Math.min(MAX, Math.max(MIN, suggested)));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const off = expired || sending || sent !== null || !onAnswer;
  const set = (next: number) => setCount(Math.min(MAX, Math.max(MIN, next)));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowUp: count + 1,
      ArrowRight: count + 1,
      ArrowDown: count - 1,
      ArrowLeft: count - 1,
      PageUp: count + 3,
      PageDown: count - 3,
      Home: MIN,
      End: MAX,
    };
    if (off || !(event.key in moves)) return;
    event.preventDefault();
    set(moves[event.key]!);
  };
  const answer = async () => {
    if (!onAnswer || off) return;
    setSending(true);
    try {
      await onAnswer(count);
      setSent(count);
    } finally {
      setSending(false);
    }
  };

  return (
    <CardFrame cardType="castBoard" data-asking="" title={t`How many videos should I make?`}>
      <p className="m-0 max-w-[60ch] text-sm text-ink-2">
        {/* AGT1: a plural, so one slot reads as one ("the same 1 slots" was MLX1's mk2). */}
        <Plural
          value={slotCount}
          one="Each video fills the same slot with different clips, so you can pick the one you like."
          other="Each video fills the same # slots with different clips, so you can pick the one you like."
        />
      </p>
      {sent !== null ? (
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-ink">
          <StatusMark status="running" />
          <Plural value={sent} one="Making # video…" other="Making # videos…" />
        </p>
      ) : expired ? (
        <p className="m-0 text-sm text-ink-2">{t`This run ended before you answered.`}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-pill border border-rule bg-sunken p-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="size-8 rounded-pill"
              aria-label={t`One fewer video`}
              disabled={off || count <= MIN}
              onClick={() => set(count - 1)}
            >
              <Minus aria-hidden />
            </Button>
            <div
              role="spinbutton"
              tabIndex={off ? -1 : 0}
              aria-label={t`Number of videos`}
              aria-valuemin={MIN}
              aria-valuemax={MAX}
              aria-valuenow={count}
              aria-valuetext={i18n.number(count)}
              aria-disabled={off || undefined}
              onKeyDown={onKeyDown}
              className="min-w-8 rounded-md px-1 text-center text-lg font-semibold text-ink tabular-nums"
            >
              {i18n.number(count)}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 rounded-pill"
              aria-label={t`One more video`}
              disabled={off || count >= MAX}
              onClick={() => set(count + 1)}
            >
              <Plus aria-hidden />
            </Button>
          </div>
          <Button
            variant="primary"
            loading={sending}
            disabled={!onAnswer || expired}
            onClick={() => void answer()}
          >
            <Plural value={count} one="Make # video" other="Make # videos" />
          </Button>
        </div>
      )}
    </CardFrame>
  );
}
