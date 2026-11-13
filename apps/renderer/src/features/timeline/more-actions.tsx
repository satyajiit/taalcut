// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import {
  dispatchReceiptSchema,
  RationalTime,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorResultSchema,
  VIDEO_SIZES,
  type TimelineId,
  type VideoAspect,
} from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { useState } from 'react';
import type { ClipView, TimelineModel } from './model';
import type { Playhead } from './playhead';
import type { Edits } from './use-edits';

export function MoreActions({
  clip,
  model,
  playhead,
  edits,
  onVideo,
  onCover,
}: {
  clip: ClipView | undefined;
  model: TimelineModel;
  playhead: Playhead;
  edits: Edits;
  onVideo(id: TimelineId): void;
  onCover(): void;
}) {
  const { t } = useLingui();
  const [seconds, setSeconds] = useState(2);
  const [made, setMade] = useState<TimelineId | null>(null);
  const resize = async (aspect: VideoAspect) => {
    const done = await edits.command(N.makeSize, { aspect });
    if (!done.ok) return;
    const receipt = dispatchReceiptSchema.safeParse(done.value);
    const result = simpleEditorResultSchema.safeParse(receipt.success ? receipt.data.result : done.value);
    if (result.success) setMade(result.data.timelineId);
  };
  const held = !!clip?.item.holdFrame;
  return (
    <section className="flex flex-col gap-3 border-b border-rule-subtle p-4" aria-label={t`Video actions`}>
      <Button size="sm" variant="secondary" onClick={onCover}>{t`Choose cover`}</Button>
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-label">{t`Make another size`}</span>
        {(Object.keys(VIDEO_SIZES) as VideoAspect[]).map((aspect) => (
          <Button
            key={aspect}
            size="sm"
            variant="secondary"
            disabled={edits.pending}
            onClick={() => void resize(aspect)}
          >
            {aspect}
          </Button>
        ))}
      </div>
      <p className="m-0 type-meta text-ink-2">{t`Creates an independent video copy. Your original stays as it is.`}</p>
      {made ? (
        <Button size="sm" variant="secondary" onClick={() => onVideo(made)}>{t`Open the new video`}</Button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 type-label">
          {t`Hold length (seconds)`}
          <input
            type="number"
            min={model.rate.den / model.rate.num}
            max={60}
            step={0.1}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
            className="w-20 rounded-md border border-rule bg-raised p-1"
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={
            edits.pending || !clip || clip.item.locked || clip.item.media.kind !== 'video' || seconds <= 0
          }
          title={
            !clip ? t`Select a video scene first` : clip.item.locked ? t`Unlock this scene first` : undefined
          }
          onClick={() => {
            if (!clip) return;
            const duration = RationalTime.fromSeconds(seconds, model.rate);
            void edits.command(held ? N.setHoldDuration : N.freezeFrame, {
              clipId: clip.item.id,
              duration,
              ...(!held ? { at: RationalTime.of(playhead.frame(), model.rate) } : {}),
            });
          }}
        >
          {held ? t`Change hold length` : t`Freeze this moment`}
        </Button>
      </div>
    </section>
  );
}
