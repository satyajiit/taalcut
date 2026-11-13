// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: a sound's controls (EDT1-OPS) · system: DESIGN.md v0.6
 * the inspector for a voice line, a sound effect or the music (the sound lane's items): Volume, its sound on or off,
 *   Fade in and Fade out, and Earlier or Later by a beat; each change is one undoable edit, a slider's on release
 * states: the kit's Switch, Select, range and Button (default, hover, focus-visible, disabled) · disabled (muted:
 *   level and fades) · loading (the control's own busy) · error (the editor's line under the transport) · empty
 *   (the item went: one plain line) */
import { useLingui } from '@lingui/react/macro';
import { defaultMusicBed, type Clip, type Timeline } from '@taalcut/core';
import { Button, Select, Switch } from '@taalcut/ui';
import { useId, useState } from 'react';
import { CommitRange } from '../brand/commit-fields';
import { atRate, type TimelineModel } from './model';
import { FADE_CHOICES, fadeSeconds } from './edit-ops';
import type { Edits } from './use-edits';

/** A voice line or an effect by its id, or the music. */
export type SoundItem = { readonly kind: 'clip'; readonly clipId: string } | { readonly kind: 'music' };

function audioClip(timeline: Timeline, clipId: string): Clip | undefined {
  for (const track of timeline.tracks)
    if (track.kind === 'audio')
      for (const item of track.items) if (item.type === 'clip' && item.id === clipId) return item;
  return undefined;
}

export interface SoundItemControlsProps {
  timeline: Timeline;
  model: TimelineModel;
  item: SoundItem;
  edits: Edits;
}

export function SoundItemControls({ timeline, model, item, edits }: SoundItemControlsProps) {
  const { t, i18n } = useLingui();
  const heading = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const clip = item.kind === 'clip' ? audioClip(timeline, item.clipId) : undefined;
  const bed = timeline.mix.music ?? defaultMusicBed(model.rate);
  if (item.kind === 'clip' && !clip)
    return <p className="m-0 type-body text-ink-2">{t`This sound isn’t in the video any more.`}</p>;
  if (item.kind === 'music' && (timeline.music.path === 'platformSound' || timeline.music.path === 'none'))
    return <p className="m-0 type-body text-ink-2">{t`This video has no music of its own.`}</p>;

  const sound =
    clip?.audio ??
    ({
      gainDb: 'gainDb' in timeline.music ? timeline.music.gainDb : 0,
      muted: bed.muted,
      fadeIn: bed.fadeIn,
      fadeOut: bed.fadeOut,
    } as const);
  const target = clip ? { kind: 'clips', clipIds: [clip.id] } : { kind: 'music' };
  const run = async (key: string, payload: Record<string, unknown>, name = 'audio.setVolume') => {
    setBusy(key);
    try {
      await edits.command(name, payload);
    } finally {
      setBusy(null);
    }
  };
  const seconds = (value: number) => atRate((value * model.rate.num) / model.rate.den, model.rate);
  const move = (beats: number) =>
    void run(
      beats < 0 ? 'earlier' : 'later',
      {
        target: clip ? { kind: 'clip', clipId: clip.id } : { kind: 'music' },
        by: atRate(beats * model.beatFrames, model.rate),
      },
      'audio.move',
    );
  const db = (value: number) => {
    const level = i18n.number(value, { signDisplay: 'exceptZero' });
    return t`${level} dB`;
  };
  const fade = (value: number) => {
    const length = i18n.number(value);
    return value === 0 ? t`None` : t`${length} s`;
  };
  const title =
    item.kind === 'music'
      ? t`The music`
      : clip && isVoice(timeline, clip.id)
        ? t`A voice line`
        : t`A sound effect`;

  return (
    <section className="flex flex-col gap-3" aria-labelledby={heading} data-slot="sound-item-controls">
      <h3 id={heading} className="m-0 type-label text-ink-2">
        {title}
      </h3>
      <Switch
        checked={!sound.muted}
        loading={busy === 'mute'}
        label={t`Sound on`}
        onCheckedChange={(on) => void run('mute', { target, muted: !on })}
      />
      <CommitRange
        label={t`Volume`}
        value={sound.gainDb}
        min={-30}
        max={6}
        step={1}
        words={db}
        disabled={sound.muted}
        onCommit={(gainDb) => void run('volume', { target, gainDb })}
      />
      <div className="grid grid-cols-2 gap-3">
        {(['fadeIn', 'fadeOut'] as const).map((key) => (
          <FadeField
            key={key}
            label={key === 'fadeIn' ? t`Fade in` : t`Fade out`}
            value={fadeSeconds(sound[key])}
            disabled={sound.muted}
            words={fade}
            onChange={(value) => void run(key, { target, [key]: seconds(value) })}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" loading={busy === 'earlier'} onClick={() => move(-1)}>
          {t`A beat earlier`}
        </Button>
        <Button size="sm" variant="secondary" loading={busy === 'later'} onClick={() => move(1)}>
          {t`A beat later`}
        </Button>
      </div>
    </section>
  );
}

const isVoice = (timeline: Timeline, clipId: string) =>
  timeline.tracks.some(
    (track) =>
      track.kind === 'audio' && track.role === 'voice' && track.items.some((item) => item.id === clipId),
  );

function FadeField(props: {
  label: string;
  value: number;
  disabled: boolean;
  words: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="type-label text-ink">
        {props.label}
      </label>
      <Select
        id={id}
        value={String(props.value)}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
      >
        {FADE_CHOICES.map((value) => (
          <option key={value} value={value}>
            {props.words(value)}
          </option>
        ))}
      </Select>
    </div>
  );
}
