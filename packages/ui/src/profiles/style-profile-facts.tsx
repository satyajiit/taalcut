// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: style profile facts (LRN1-STY, UX3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 · eight measured numbers as a definition list on the section's surface: each a label in
 *   ink-2 led by its icon in ink-3 (UX3: for scanning), its value in ink at 600, one line of detail in ink-3; tabular
 *   figures; no AI accent (Taalcut measured these: nothing here is the AI's). Cuts on the beat's icon is rose, the
 *   beat's colour everywhere else (breakdown's BPM, the beat marks)
 * states: default · a set without beats ("No beat found") · without text ("No text on screen") · without loudness
 */
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { StyleProfile } from '@taalcut/core';
import {
  AudioLines,
  ChartNoAxesColumn,
  Focus,
  Music,
  Scissors,
  Timer,
  Type,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useFormatters } from '../lib/format';
import { SHOT_TYPE_LABELS } from '../templates/slot-words';
import {
  ASPECT_WORDS,
  POSITION_WORDS,
  SIZE_WORDS,
  SOUND_WORDS,
  TRANSITION_WORDS,
} from './style-profile-words';

const NOT_DESCRIBED = msg`A shot Taalcut couldn’t describe`;

function Fact({
  icon: Icon,
  label,
  value,
  detail,
  beat,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  beat?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-ink-2">
        <Icon aria-hidden className={cn('size-3.5 shrink-0', beat ? 'text-beat-strong' : 'text-ink-3')} />
        {label}
      </dt>
      <dd className="m-0 text-base font-semibold text-ink tabular-nums">{value}</dd>
      {detail ? <dd className="m-0 text-xs text-ink-3 tabular-nums">{detail}</dd> : null}
    </div>
  );
}

/** Pacing and the opening: shot length, cuts on the beat, the first 3 seconds and the opening shot. */
function PacingFacts({ pacing, hook }: Pick<StyleProfile, 'pacing' | 'hook'>) {
  const { t, i18n } = useLingui();
  const formatters = useFormatters();
  const seconds = (value: number) => formatters.duration(value * 1000);
  const opening = hook.shotType[0];
  const first3s = Math.round(pacing.shotsInFirst3s.median * 10) / 10;
  const shortest = seconds(pacing.shot.q1);
  const longest = seconds(pacing.shot.q3);
  const openingLength = seconds(hook.duration.median);
  const onBeat = pacing.cutsOnBeat;
  return (
    <>
      <Fact
        icon={ChartNoAxesColumn}
        label={t`Shot length`}
        value={seconds(pacing.shot.median)}
        detail={t`Most between ${shortest} and ${longest}`}
      />
      <Fact
        icon={AudioLines}
        beat
        label={t`Cuts on the beat`}
        value={onBeat === null ? t`No beat found` : formatters.percent(onBeat)}
        detail={
          onBeat === null
            ? null
            : t`${plural(pacing.withBeats, { one: 'In the # video with a beat', other: 'In the # videos with a beat' })}`
        }
      />
      <Fact
        icon={Zap}
        label={t`First 3 seconds`}
        value={t`${plural(first3s, { one: '# shot', other: '# shots' })}`}
        detail={t`Opening shot ${openingLength}`}
      />
      <Fact
        icon={Focus}
        label={t`Opens on`}
        value={
          !opening || opening.value === 'unknown'
            ? i18n._(NOT_DESCRIBED)
            : i18n._(SHOT_TYPE_LABELS[opening.value])
        }
        detail={t`${plural(hook.withText, { one: '# opens with text', other: '# open with text' })}`}
      />
    </>
  );
}

/** How the shots meet, the text on screen, the sound and the shape. */
function FormFacts({
  mix,
  overlays,
  audio,
  form,
}: Pick<StyleProfile, 'mix' | 'overlays' | 'audio' | 'form'>) {
  const { t, i18n } = useLingui();
  const formatters = useFormatters();
  const cuts = mix.transitions.reduce((sum, row) => sum + row.count, 0);
  const [firstMove, secondMove] = mix.transitions;
  const share = (count: number) => formatters.percent(cuts === 0 ? 0 : count / cuts);
  const sound = audio.kind[0];
  const aspect = form.aspect[0];
  const size = overlays.size[0];
  const position = overlays.position[0];
  const firstShare = firstMove ? share(firstMove.count) : '';
  const secondWord = secondMove ? i18n._(TRANSITION_WORDS[secondMove.value]) : '';
  const secondShare = secondMove ? share(secondMove.count) : '';
  const loudness = audio.loudnessLufs === null ? null : formatters.count(audio.loudnessLufs);
  return (
    <>
      <Fact
        icon={Scissors}
        label={t`Between shots`}
        value={firstMove ? i18n._(TRANSITION_WORDS[firstMove.value]) : t`One shot each`}
        detail={secondMove ? t`${firstShare} · ${secondWord} ${secondShare}` : firstShare}
      />
      <Fact
        icon={Type}
        label={t`On-screen text`}
        value={size ? i18n._(SIZE_WORDS[size.value]) : t`No text on screen`}
        detail={position ? i18n._(POSITION_WORDS[position.value]) : null}
      />
      <Fact
        icon={Music}
        label={t`Sound`}
        value={sound ? i18n._(SOUND_WORDS[sound.value]) : t`Not measured`}
        detail={loudness === null ? null : t`Loudness ${loudness} LUFS`}
      />
      <Fact
        icon={Timer}
        label={t`Length`}
        value={formatters.duration(form.length.median * 1000)}
        detail={aspect ? i18n._(ASPECT_WORDS[aspect.value]) : null}
      />
    </>
  );
}

/** What a set's templates have in common, measured: pacing, the opening, cuts, text, sound and shape. */
export function StyleProfileFacts({ profile }: { profile: StyleProfile }) {
  return (
    <dl data-slot="style-profile-facts" className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
      <PacingFacts pacing={profile.pacing} hook={profile.hook} />
      <FormFacts mix={profile.mix} overlays={profile.overlays} audio={profile.audio} form={profile.form} />
    </dl>
  );
}
