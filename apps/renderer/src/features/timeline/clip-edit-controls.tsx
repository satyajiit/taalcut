// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: a clip's own sound (EDT1-OPS; MORE1 moved the rest) · system: DESIGN.md v0.6
 * under the clip inspector's title in the Sound tab: Its own sound (on or off), Volume and the fades in and out,
 *   each a plain label over its control; every change is one undoable edit, a slider's on release. Speed, the
 *   transition and the colour are the More tab's tiles now (more/more-gallery.tsx)
 * states: the kit's Select, Switch and range (default, hover, focus-visible, disabled) · disabled (a locked
 *   clip; a muted clip's volume and fades) · loading (the control's own busy while its edit is on its way) ·
 *   error (the editor's line under the transport) · success (silent: the clip sounds it) · a photo (no sound:
 *   nothing to show) */
import { useLingui } from '@lingui/react/macro';
import { Select, Switch } from '@taalcut/ui';
import { useId, useState, type ReactNode } from 'react';
import { CommitRange } from '../brand/commit-fields';
import { editorOps, FADE_CHOICES, fadeSeconds } from './edit-ops';
import type { ClipView, TimelineModel } from './model';
import type { Edits } from './use-edits';

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="type-label text-ink">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export interface ClipEditControlsProps {
  model: TimelineModel;
  clip: ClipView;
  edits: Edits;
}

export function ClipEditControls({ model, clip, edits }: ClipEditControlsProps) {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState<string | null>(null);
  const ops = editorOps(edits, model.rate);
  const id = clip.item.id;
  const locked = clip.item.locked;
  const video = clip.item.media.kind === 'video';
  const audio = clip.item.audio;
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };
  const db = (value: number) => {
    const level = i18n.number(value, { signDisplay: 'exceptZero' });
    return t`${level} dB`;
  };
  const fade = (value: number) => {
    const length = i18n.number(value);
    return value === 0 ? t`None` : t`${length} s`;
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`edit-${id}`} data-slot="clip-edit-controls">
      <h3 id={`edit-${id}`} className="m-0 type-label text-ink-2">
        {t`Edit this clip`}
      </h3>
      {video ? (
        <div className="flex flex-col gap-3" data-slot="clip-sound">
          <Switch
            checked={!audio.muted}
            disabled={locked}
            loading={busy === 'mute'}
            label={t`Its own sound`}
            onCheckedChange={(on) => void run('mute', () => ops.volume(id, { muted: !on }))}
          />
          <CommitRange
            label={t`Volume`}
            value={audio.gainDb}
            min={-30}
            max={6}
            step={1}
            words={db}
            disabled={locked || audio.muted}
            onCommit={(gainDb) => void run('volume', () => ops.volume(id, { gainDb }))}
          />
          <div className="grid grid-cols-2 gap-3">
            {(['fadeInSeconds', 'fadeOutSeconds'] as const).map((key) => (
              <Field key={key} label={key === 'fadeInSeconds' ? t`Fade in` : t`Fade out`}>
                {(field) => (
                  <Select
                    id={field}
                    data-slot={key === 'fadeInSeconds' ? 'clip-fade-in' : 'clip-fade-out'}
                    value={String(fadeSeconds(key === 'fadeInSeconds' ? audio.fadeIn : audio.fadeOut))}
                    disabled={locked || audio.muted}
                    onChange={(event) =>
                      void run(key, () => ops.volume(id, { [key]: Number(event.target.value) }))
                    }
                  >
                    {FADE_CHOICES.map((value) => (
                      <option key={value} value={value}>
                        {fade(value)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
