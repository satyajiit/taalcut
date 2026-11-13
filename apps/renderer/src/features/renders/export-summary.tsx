// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the export's summary (UX4) · system: DESIGN.md v0.6 + UX4
 * the last step before Export: every step this export showed, one hairline row each, its name in ink-2, what was
 *   chosen in words (never a control), and Change, which opens that step. Read top to bottom like the steps
 * states: default · Change's (default, hover, focus-visible, active) · disabled while the export starts
 */
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { ExportOptions } from '@taalcut/core';
import { Button, presetLabel, VERB_ICONS } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { formatBytes } from '../shared/format';
import type { ExportStep, ExportStepId } from './export-steps';
import type { ExportChoices, ExportContext } from './sections';
import { codecChoices } from './sections/codec-choices';
import { follows, reframedClips } from './sections/timeline-facts';

type PresetEntry = ExportOptions['presets'][number];

/** The music in words (REF1: the reel's music by default; off, the sound is added in the app). */
const MUSIC_WORDS = {
  none: msg`Original sound, no added music`,
  platformSound: msg`No music in the file: add the sound in the app`,
  ownTrack: msg`Your own track`,
  referenceAudio: msg`The reel’s music`,
  generated: msg`Music Taalcut made for this video`,
} as const;

export interface ExportSummaryProps {
  context: ExportContext;
  choices: ExportChoices;
  selected: PresetEntry;
  steps: readonly ExportStep[];
  onChange: (step: ExportStepId) => void;
  disabled: boolean;
}

/** What each step decided, in words. */
function useChosen(context: ExportContext, choices: ExportChoices, selected: PresetEntry) {
  const { t, i18n } = useLingui();
  const { options, timeline, style, credits } = context;
  const words = (parts: readonly (string | null | false)[]) => parts.filter(Boolean).join(' · ');
  const size = formatBytes(i18n, selected.estimate.bytes);
  const many = codecChoices(selected).length > 1;
  const codec = choices.codec ?? selected.preset.video.codec;
  const rateFps = choices.rate ? i18n.number(Math.round(choices.rate.num / choices.rate.den)) : null;
  const bumpers = style !== null && (style.intro !== null || style.outro !== null) && choices.includeBumpers;
  const clips = reframedClips(timeline);
  const following = clips.filter(follows).length;
  const followCount = i18n.number(following);
  const clipCount = i18n.number(clips.length);
  const lines =
    credits.status === 'ready' ? credits.credits.required.length + credits.credits.courtesy.length : 0;
  const captions = options.captions;
  return {
    destination: words([
      presetLabel(i18n, selected.preset.id),
      many && codec === 'hevc' ? t`HEVC, smaller file` : null,
      many && codec === 'av1' ? t`AV1` : null,
      rateFps ? t`${rateFps} frames a second` : null,
      t`about ${size}`,
      bumpers ? t`with the intro and outro` : null,
    ]),
    sound: words([
      i18n._(MUSIC_WORDS[options.music.current.path]),
      timeline.voiceover ? t`with the voiceover` : null,
    ]),
    captions: !captions.available
      ? t`No captions`
      : words([
          choices.burnIn ? t`Burned into the video` : t`Not in the video`,
          choices.srt ? t`a subtitle file (.srt) beside it` : null,
        ]),
    framing:
      following === 0
        ? t`A still crop from the middle of each shot`
        : following === clips.length
          ? t`Follows the person in each shot`
          : t`${followCount} of ${clipCount} follow the person in them.`,
    credits: words([
      options.credentials?.add ? t`Content Credentials added` : t`No Content Credentials`,
      lines > 0
        ? t`${plural(lines, { one: '# credit to put in the post', other: '# credits to put in the post' })}`
        : null,
    ]),
  } satisfies Record<Exclude<ExportStepId, 'summary'>, ReactNode>;
}

export function ExportSummary({ context, choices, selected, steps, onChange, disabled }: ExportSummaryProps) {
  const { t, i18n } = useLingui();
  const chosen = useChosen(context, choices, selected);
  return (
    <dl data-slot="export-summary" className="m-0 flex flex-col border-y border-rule-subtle">
      {steps.map((step) => {
        if (step.id === 'summary') return null;
        const name = i18n._(step.name);
        return (
          <div
            key={step.id}
            data-step={step.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule-subtle py-2.5 first:border-t-0"
          >
            <dt className="w-36 shrink-0 type-label text-ink-2">{name}</dt>
            <dd className="m-0 min-w-0 flex-1 basis-48 type-body text-ink tabular-nums">{chosen[step.id]}</dd>
            <dd className="m-0 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                icon={VERB_ICONS.edit}
                aria-label={t`Change ${name}`}
                disabled={disabled}
                onClick={() => onChange(step.id)}
              >
                {t`Change`}
              </Button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
