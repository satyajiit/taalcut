// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { MIN_CLIP_FRAMES } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { useState } from 'react';
import type { ClipView, TimelineModel } from './model';
import type { Edits } from './use-edits';

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
      <p className="m-0 type-meta text-ink-2">{t`Trim the beginning or end. The following scenes move with the edit.`}</p>
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
