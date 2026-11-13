// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CLIP_SETTINGS, SIMPLE_EDITOR_COMMANDS as N, type TimelineItemId } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { useState } from 'react';
import type { TimelineModel } from './model';
import type { Edits } from './use-edits';

export function BulkControls({
  ids,
  model,
  edits,
}: {
  ids: TimelineItemId[];
  model: TimelineModel;
  edits: Edits;
}) {
  const { t, i18n } = useLingui();
  const [source, setSource] = useState<TimelineItemId | ''>('');
  const [settings, setSettings] = useState<string[]>(['color', 'sound', 'framing']);
  const [gain, setGain] = useState(-6);
  const [exposure, setExposure] = useState(0);
  const selected = model.clips.filter((clip) => ids.includes(clip.item.id));
  const locked = selected.some((clip) => clip.item.locked);
  const disabled = edits.pending || locked || !ids.length;
  const supportsSound = selected.every((clip) => clip.item.media.kind !== 'image');
  const actualSource = model.clips.find((clip) => clip.item.id === source)?.item.id ?? ids[0];
  const labels = { color: t`Color`, sound: t`Sound`, framing: t`Framing` };
  const selectedCount = i18n.number(ids.length);
  return (
    <section className="flex flex-col gap-3 p-4" aria-label={t`Adjust selected scenes`}>
      <h2 className="m-0 type-card-title">{t`${selectedCount} scenes selected`}</h2>
      {locked ? (
        <p className="m-0 type-meta text-ink-2">{t`Unlock every selected scene before making a shared adjustment.`}</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 type-label">
          {t`Exposure`}
          <input
            type="number"
            min={-2}
            max={2}
            step={0.1}
            value={exposure}
            onChange={(e) => setExposure(Number(e.target.value))}
            className="w-20 rounded-md border border-rule bg-raised px-2 py-1"
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => void edits.command(N.adjustClips, { clipIds: ids, color: { exposure } })}
        >{t`Apply color`}</Button>
        <label className="flex flex-col gap-1 type-label">
          {t`Sound level (dB)`}
          <input
            type="number"
            min={-60}
            max={12}
            value={gain}
            onChange={(e) => setGain(Number(e.target.value))}
            className="w-20 rounded-md border border-rule bg-raised px-2 py-1"
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || !supportsSound}
          title={!supportsSound ? t`Photos have no source sound` : undefined}
          onClick={() => void edits.command(N.adjustClips, { clipIds: ids, sound: { gainDb: gain } })}
        >{t`Apply sound`}</Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() =>
            void edits.command(N.adjustClips, { clipIds: ids, framing: { fit: 'contain', reframe: null } })
          }
        >{t`Show whole image`}</Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() =>
            void edits.command(N.adjustClips, { clipIds: ids, framing: { fit: 'cover', reframe: null } })
          }
        >{t`Fill frame`}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-rule-subtle pt-3">
        <label className="flex items-center gap-2 type-label">
          {t`Copy from`}
          <select
            value={actualSource}
            onChange={(e) => setSource(e.target.value as TimelineItemId)}
            className="rounded-md border border-rule bg-raised p-1"
          >
            {model.clips.map((clip) => {
              const sceneNumber = i18n.number(clip.number);
              return <option key={clip.item.id} value={clip.item.id}>{t`Scene ${sceneNumber}`}</option>;
            })}
          </select>
        </label>
        {CLIP_SETTINGS.map((setting) => (
          <label key={setting} className="flex items-center gap-1 type-meta">
            <input
              type="checkbox"
              checked={settings.includes(setting)}
              onChange={(e) =>
                setSettings((old) =>
                  e.target.checked ? [...old, setting] : old.filter((item) => item !== setting),
                )
              }
            />
            {labels[setting]}
          </label>
        ))}
        <Button
          size="sm"
          disabled={disabled || !settings.length || !actualSource}
          onClick={() =>
            void edits.command(N.copyClipSettings, { sourceClipId: actualSource, clipIds: ids, settings })
          }
        >{t`Copy settings`}</Button>
      </div>
    </section>
  );
}
