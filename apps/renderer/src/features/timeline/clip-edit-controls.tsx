// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: a clip's edit controls (EDT1-OPS) · system: DESIGN.md v0.6
 * under the clip inspector's shots: Speed (a choice from a quarter to four times), Into the next clip (a cut or a
 *   transition), Sound (level, mute, fades) and Colour (a look, brightness, warmth, colour), each a plain label over
 *   its control; every change is one undoable edit, a slider's on release
 * states: the kit's Select, Switch and range (default, hover, focus-visible, disabled) · disabled (a locked clip; a
 *   photo has no speed or sound; the last clip has no next one) · loading (the control's own busy while its edit is
 *   on its way) · error (the editor's line under the transport) · success (silent: the clip shows it) */
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { GRADE_LOOKS, NEUTRAL_GRADE, type Grade, type GradePatch } from '@taalcut/core';
import { Button, Select, Switch } from '@taalcut/ui';
import { useId, useState, type ReactNode } from 'react';
import { CommitRange } from '../brand/commit-fields';
import {
  editorOps,
  FADE_CHOICES,
  fadeSeconds,
  hasNext,
  SPEED_CHOICES,
  speedOf,
  TRANSITION_CHOICES,
  transitionAfter,
  transitionChoice,
  type TransitionChoice,
} from './edit-ops';
import type { ClipView, TimelineModel } from './model';
import type { Edits } from './use-edits';

/** A transition's name in words (also the bed's marks, transition-marks.tsx). */
export const TRANSITION_WORDS = {
  cut: msg({ id: 'editor.ops.transition.cut', message: 'A plain cut' }),
  dissolve: msg({ id: 'editor.ops.transition.dissolve', message: 'Crossfade' }),
  fade: msg({ id: 'editor.ops.transition.fade', message: 'Dip to black' }),
  flash: msg({ id: 'editor.ops.transition.flash', message: 'Flash of white' }),
  whip: msg({ id: 'editor.ops.transition.whip', message: 'Whip' }),
  zoom: msg({ id: 'editor.ops.transition.zoom', message: 'Zoom through' }),
  slide: msg({ id: 'editor.ops.transition.slide', message: 'Slide in' }),
} as const;

const LOOK_WORDS = {
  none: msg({ id: 'editor.ops.look.none', message: 'Colour as shot' }),
  vivid: msg({ id: 'editor.ops.look.vivid', message: 'Vivid' }),
  muted: msg({ id: 'editor.ops.look.muted', message: 'Soft colours' }),
  warm: msg({ id: 'editor.ops.look.warm', message: 'Warm' }),
  cool: msg({ id: 'editor.ops.look.cool', message: 'Cool' }),
  mono: msg({ id: 'editor.ops.look.mono', message: 'Black and white' }),
  vintage: msg({ id: 'editor.ops.look.vintage', message: 'Vintage' }),
  faded: msg({ id: 'editor.ops.look.faded', message: 'Faded' }),
  cinematic: msg({ id: 'editor.ops.look.cinematic', message: 'Cinematic' }),
} as const;

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
  section?: 'sound' | 'more';
}

export function ClipEditControls({ model, clip, edits, section = 'more' }: ClipEditControlsProps) {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState<string | null>(null);
  const ops = editorOps(edits, model.rate);
  const id = clip.item.id;
  const locked = clip.item.locked;
  const video = clip.item.media.kind === 'video';
  const grade: Grade = { ...NEUTRAL_GRADE, ...clip.item.grade };
  const audio = clip.item.audio;
  const next = hasNext(model, clip);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };
  const setGrade = (patch: GradePatch | null) => void run('grade', () => ops.grade({ clipIds: [id] }, patch));
  const speedWords = (speed: number) => {
    const times = i18n.number(speed);
    return speed === 1 ? t`Normal` : speed === 0.5 ? t`Half speed` : t`${times}× speed`;
  };
  const db = (value: number) => {
    const level = i18n.number(value, { signDisplay: 'exceptZero' });
    return t`${level} dB`;
  };
  const step = (value: number) =>
    value === 0 ? t`As shot` : i18n.number(value, { signDisplay: 'exceptZero', maximumFractionDigits: 1 });
  const fade = (value: number) => {
    const length = i18n.number(value);
    return value === 0 ? t`None` : t`${length} s`;
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`edit-${id}`} data-slot="clip-edit-controls">
      <h3 id={`edit-${id}`} className="m-0 type-label text-ink-2">
        {t`Edit this clip`}
      </h3>
      {section === 'more' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t`Speed`}>
            {(field) => (
              <Select
                id={field}
                data-slot="clip-speed"
                value={String(speedOf(clip))}
                disabled={locked || !video}
                aria-busy={busy === 'speed'}
                onChange={(event) => void run('speed', () => ops.speed(id, Number(event.target.value)))}
              >
                {SPEED_CHOICES.map((speed) => (
                  <option key={speed} value={speed}>
                    {speedWords(speed)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t`Into the next clip`}>
            {(field) => (
              <Select
                id={field}
                data-slot="clip-transition"
                value={transitionChoice(transitionAfter(model, clip))}
                disabled={locked || !next}
                aria-busy={busy === 'transition'}
                onChange={(event) =>
                  void run('transition', () => ops.transition(id, event.target.value as TransitionChoice))
                }
              >
                {TRANSITION_CHOICES.map((kind) => (
                  <option key={kind} value={kind}>
                    {i18n._(TRANSITION_WORDS[kind])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}

      {video && section === 'sound' ? (
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

      {section === 'more' ? (
        <div className="flex flex-col gap-3" data-slot="clip-colour">
          <Field label={t`Colour`}>
            {(field) => (
              <Select
                id={field}
                data-slot="clip-look"
                value={grade.look ?? 'none'}
                disabled={locked}
                aria-busy={busy === 'grade'}
                onChange={(event) =>
                  setGrade({
                    look: event.target.value === 'none' ? null : (event.target.value as Grade['look']),
                  })
                }
              >
                {(['none', ...GRADE_LOOKS] as const).map((look) => (
                  <option key={look} value={look}>
                    {i18n._(LOOK_WORDS[look])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <CommitRange
            label={t`Brightness`}
            value={grade.exposure}
            min={-1}
            max={1}
            step={0.1}
            words={step}
            disabled={locked}
            onCommit={(exposure) => setGrade({ exposure })}
          />
          <CommitRange
            label={t`Warmth`}
            value={grade.temperature}
            min={-1}
            max={1}
            step={0.1}
            words={step}
            disabled={locked}
            onCommit={(temperature) => setGrade({ temperature })}
          />
          <CommitRange
            label={t`Colour strength`}
            value={grade.saturation}
            min={-1}
            max={1}
            step={0.1}
            words={step}
            disabled={locked}
            onCommit={(saturation) => setGrade({ saturation })}
          />
          {clip.item.grade ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={locked}
              onClick={() => setGrade(null)}
            >
              {t`Back to the colour as shot`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
