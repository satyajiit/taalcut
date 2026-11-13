// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: clip detail · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * what you can do with one clip from a card, in a line under the cut (not a floating layer in the chat's scroll):
 *   its other shots, a beat shorter or longer, Add to chat; Escape or Close folds it
 * states: default · hover/active (frames and buttons) · focus (base ring; it takes focus when it opens and gives it
 *   back to the clip when it closes) · disabled (the run ended, the clip can't get shorter: the reason in words) ·
 *   loading (the pressed control is busy) · error (the cause in one line) · success (silent: the cut shows it)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type {
  MIN_CLIP_FRAMES as CORE_MIN_CLIP_FRAMES,
  ProjectId,
  TaalcutError,
  Timeline,
  TimelineItemId,
} from '@taalcut/core';
import { MessageSquarePlus, Minus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { useCardActions } from '../cards/card-actions';
import { errorMessage } from '../feedback/error-messages';
import { AlternatesStrip } from './alternates';
import { beatFrames, castFor, placeVideo } from './timeline-math';
import { useTimecode } from './timecode';
import { shotKey, useShotFrames } from './use-shot-frames';

/**
 * Clips can't get shorter than this many frames: core's MIN_CLIP_FRAMES. The kit imports no runtime code from core,
 * so the type holds this copy to core's value (a change there fails the build here).
 */
const MIN_CLIP_FRAMES: typeof CORE_MIN_CLIP_FRAMES = 6;

export interface ClipDetailProps {
  projectId: ProjectId;
  timeline: Timeline;
  clipId: TimelineItemId;
  onClose: () => void;
  /** Off: the run ended or the timeline is gone. */
  disabled?: boolean;
  /** Without the trim buttons (the export card offers swaps only). */
  swapsOnly?: boolean;
  /** A swap went out (the export card dims its preview until the new cut arrives). */
  onSwapped?: () => void;
  className?: string;
}

export function ClipDetail({
  projectId,
  timeline,
  clipId,
  onClose,
  disabled = false,
  swapsOnly = false,
  onSwapped,
  className,
}: ClipDetailProps) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const time = useTimecode();
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const placed = placeVideo(timeline).items.find((item) => item.kind === 'clip' && item.clip.id === clipId);
  const slot = castFor(timeline, clipId);
  const alternates = slot?.alternates ?? [];
  const frames = useShotFrames(alternates);
  const beat = beatFrames(timeline);
  const rate = timeline.canvas.rate;
  const off = disabled || !actions.dispatch;

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('button')?.focus();
  }, [clipId]);

  if (!placed || placed.kind !== 'clip') return null;
  const { clip, index } = placed;
  const n = i18n.number(index);
  const canShorten = clip.duration.value - beat >= MIN_CLIP_FRAMES;

  const run = async (key: string, name: string, payload: unknown) => {
    if (off) return;
    setBusy(key);
    setError(null);
    try {
      const result = await actions.dispatch!(name, payload);
      if (!result.ok) setError(result.error);
      else if (name === 'timeline.swapClip') onSwapped?.();
    } finally {
      setBusy(null);
    }
  };
  const target = { projectId, timelineId: timeline.id, clipId };
  const trim = (frames: number) =>
    run(frames < 0 ? 'shorter' : 'longer', 'timeline.trimClip', {
      ...target,
      edge: 'end',
      by: { value: frames, rate },
    });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={root}
      role="group"
      aria-label={t`Clip ${n}`}
      onKeyDown={onKeyDown}
      data-slot="clip-detail"
      className={cn('flex flex-col gap-2 rounded-lg border border-rule-subtle bg-canvas p-3', className)}
    >
      <div className="flex items-center gap-2">
        <p className="m-0 text-sm font-semibold text-ink">{t`Clip ${n}`}</p>
        <span className="text-xs text-ink-2 tabular-nums">
          {time.clock(placed.start, rate)} · {time.length(placed.frames, rate)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="ms-auto size-7"
          aria-label={t`Close`}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      {alternates.length > 0 ? (
        <AlternatesStrip
          items={alternates.map((candidate) => ({ key: shotKey(candidate), frame: frames(candidate) }))}
          size="sm"
          disabled={off}
          swapping={busy?.startsWith('swap:') ? Number(busy.slice(5)) : null}
          label={t`Other shots for clip ${n}`}
          onSwap={(at) => {
            const candidate = alternates[at];
            if (!candidate) return;
            void run(`swap:${at}`, 'timeline.swapClip', {
              ...target,
              media: { assetId: candidate.assetId, shotId: candidate.shotId },
              sourceStart: candidate.sourceStart,
              from: 'alternate',
              scored: { score: candidate.score, parts: candidate.parts },
            });
          }}
        />
      ) : (
        <p className="m-0 text-xs text-ink-2">{t`No other shots were kept for this clip.`}</p>
      )}
      {swapsOnly ? null : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={off || !canShorten}
            loading={busy === 'shorter'}
            onClick={() => void trim(-beat)}
          >
            <Minus aria-hidden />
            {t`Shorter by a beat`}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={off}
            loading={busy === 'longer'}
            onClick={() => void trim(beat)}
          >
            <Plus aria-hidden />
            {t`Longer by a beat`}
          </Button>
          {actions.ask ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => actions.ask?.('', [{ kind: 'clip', timelineId: timeline.id, clipId }])}
            >
              <MessageSquarePlus aria-hidden />
              {t`Add to chat`}
            </Button>
          ) : null}
          {!canShorten ? <span className="text-xs text-ink-3">{t`It can’t get any shorter.`}</span> : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger-strong">
          {errorMessage(i18n, error)}
        </p>
      ) : null}
    </div>
  );
}
