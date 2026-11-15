// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { MIN_CLIP_FRAMES } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { useState } from 'react';
import type { ClipView, TimelineModel } from './model';
import type { Edits } from './use-edits';

/**
 * The exact trim: Remove and Restore by an amount, in seconds or (asked for) frames, at a scene's beginning and end.
 * Each is one `timeline.trimClip`. Folded under the Trim tool's "pick the part" (clip-part/exact-trim.tsx).
 */
export function ClipTrimControls({
  clip,
  model,
  edits,
}: {
  clip: ClipView;
  model: TimelineModel;
  edits: Edits;
}) {
  const { t, i18n } = useLingui();
  const rate = model.rate.num / model.rate.den;
  const [amount, setAmount] = useState(() => Math.max(1, Math.round(rate / 2)));
  const [precise, setPrecise] = useState(false);
  const locked = clip.item.locked || edits.pending;
  const tooShort = clip.end - clip.start - amount < MIN_CLIP_FRAMES;
  const duration = i18n.number(amount / rate, { maximumFractionDigits: 3 });
  const units = precise ? plural(amount, { one: '# frame', other: '# frames' }) : t`${duration} s`;
  const unavailable = clip.item.locked
    ? t`Unlock this scene to trim it`
    : edits.pending
      ? t`Wait for the current edit to finish`
      : tooShort
        ? t`This scene is too short to remove that much`
        : undefined;
  // TRIM1: what timeline.trimClip really does at each end (the old line said the following scenes move; only the
  // video's last edge moves anything, and its first edge moves the part instead of trimming).
  const first = clip.index === 0;
  const last = clip.index === model.positions.length - 1;
  const truths = [
    ...(first && last
      ? []
      : [
          t`Remove makes the scene shorter and what is next to that end longer by the same amount; Restore does the opposite. Nothing else moves.`,
        ]),
    ...(first
      ? [
          t`The video starts with this scene: at its beginning, Remove plays a later part of the clip and Restore an earlier one, and the scene keeps its length.`,
        ]
      : []),
    ...(last ? [t`At the end of the last scene, the video gets shorter or longer.`] : []),
    ...(model.beats.length > 0
      ? [
          t`The video follows a beat, so an end lands on the nearest beat, and a small amount may change nothing.`,
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 type-label">
          {precise ? t`Frames per adjustment` : t`Seconds per adjustment`}
          <input
            type="number"
            min={precise ? 1 : 1 / rate}
            max={Math.max(1, model.total) / (precise ? 1 : rate)}
            step={precise ? 1 : 0.1}
            value={precise ? amount : Number((amount / rate).toFixed(3))}
            className="w-20 rounded-md border border-rule bg-raised px-2 py-1"
            onChange={(event) =>
              setAmount(Math.max(1, Math.round((Number(event.target.value) || 0) * (precise ? 1 : rate))))
            }
          />
        </label>
        <label className="flex items-center gap-2 type-meta">
          <input
            type="checkbox"
            checked={precise}
            onChange={(event) => setPrecise(event.target.checked)}
            className="size-6 accent-primary-strong"
          />
          {t`Adjust by exact frames`}
        </label>
      </div>
      {truths.map((line) => (
        <p key={line} className="m-0 type-meta text-ink-2">
          {line}
        </p>
      ))}
      {(['start', 'end'] as const).map((edge) => (
        <div key={edge} className="flex flex-wrap items-center gap-2">
          <span className="w-20 type-label">{edge === 'start' ? t`Beginning` : t`End`}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || tooShort}
            title={unavailable}
            onClick={() => void edits.trim(clip.item.id, edge, -amount)}
          >{t`Remove ${units}`}</Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            title={locked ? unavailable : undefined}
            onClick={() => void edits.trim(clip.item.id, edge, amount)}
          >{t`Restore ${units}`}</Button>
        </div>
      ))}
    </div>
  );
}
