// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { TimelineItemId } from '@taalcut/core';
import { cn, useTimecode } from '@taalcut/ui';
import { useId } from 'react';
import { KEYS } from './keys';
import type { ClipView, TimelineModel } from './model';
import type { AiEditMark } from './ai-edit-marks';
import { ScenePicture } from './clip-part/scene-picture';
import { shotOptions } from './other-shots/shot-options';
import type { ShotLookup } from './shot-frames';

export function SceneStrip({
  model,
  selectedIds,
  aiMarks,
  onPick,
  pictureFor,
  lookup,
  onEdit,
}: {
  model: TimelineModel;
  aiMarks?: ReadonlyMap<string, AiEditMark>;
  /** The shot's own picture: what a card shows until its file's filmstrip is there. */
  pictureFor(clip: ClipView): string | null;
  /** TRIM1: the files' filmstrips, so a card shows a frame from the part its scene plays. */
  lookup?: ShotLookup;
  onEdit(): void;
  selectedIds: TimelineItemId[];
  onPick(id: TimelineItemId, shift: boolean, toggle: boolean): void;
}) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const othersHint = useId();
  return (
    <div
      role="group"
      aria-label={t`Scenes`}
      data-slot="scene-strip"
      data-scroll-x
      className="flex gap-2 overflow-x-auto px-3 py-3"
    >
      {/* EDT2: read after a scene's name when the cast kept other shots for it (other-shots/). */}
      <span id={othersHint} hidden>
        {t`Up arrow shows other shots.`}
      </span>
      {model.clips.map((clip, index) => {
        const selected = selectedIds.includes(clip.item.id);
        const mark = aiMarks?.get(clip.item.id);
        const number = i18n.number(index + 1);
        const picture = pictureFor(clip);
        const duration = time.length(clip.end - clip.start, model.rate);
        const others = shotOptions(clip) !== null;
        return (
          <div key={clip.item.id} data-scene-clip={clip.item.id} className="relative shrink-0">
            <button
              type="button"
              aria-pressed={selected}
              aria-keyshortcuts={others ? KEYS.otherShots : undefined}
              aria-describedby={others ? othersHint : undefined}
              data-ai-edit={mark}
              className={cn(
                'w-28 shrink-0 overflow-hidden rounded-md border border-rule bg-surface text-start text-ink',
                'hover:border-rule-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                selected && 'border-primary-strong ring-1 ring-primary-strong',
              )}
              onClick={(event) => {
                onPick(clip.item.id, event.shiftKey, event.metaKey || event.ctrlKey);
              }}
              onDoubleClick={onEdit}
            >
              <div className="aspect-video overflow-hidden bg-viewer">
                <ScenePicture clip={clip} model={model} lookup={lookup} still={picture} />
              </div>
              <div className="flex items-baseline justify-between gap-1 px-2 py-1.5">
                <span className="type-label">{t`Scene ${number}`}</span>
                <span className="type-meta text-ink-2">{duration}</span>
              </div>
            </button>
            {mark ? (
              <span className="pointer-events-none absolute left-1 top-1 rounded-sm bg-ai-soft px-1 type-meta text-ai-strong">
                {mark === 'changed' ? t`AI changed` : t`AI target`}
              </span>
            ) : null}
            <input
              type="checkbox"
              className="absolute right-1 top-1 size-6 accent-primary-strong"
              aria-label={t`Select scene ${number}`}
              checked={selected}
              onChange={() => onPick(clip.item.id, false, true)}
            />
          </div>
        );
      })}
    </div>
  );
}
