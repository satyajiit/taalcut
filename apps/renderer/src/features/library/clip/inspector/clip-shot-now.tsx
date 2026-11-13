// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the shot at the playhead · genre: atmospheric studio app · system: DESIGN.md v0.5
 * follows the playhead: "Shot 2 of 4" with its stretch in JetBrains Mono, its kind as the scrubber's chip (the
 *   family's dot and word), how the camera moves, a rose chip for the people in it, Taalcut's sentence led by the AI
 *   mark, the text on screen in violet (its job here) as written, and Find similar. A new shot fades in in place
 * states: filled · not described yet (one ink-3 line) · no shots (not drawn) · Find similar: the Button's own
 *   (default, hover, focus, active; it navigates) · quality flags as warning chips with their words
 * motion: the new shot's block fades in (tc-fade-in: opacity, --dur-short, --ease-out); reduced motion: base.css
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { QualityFlag } from '@taalcut/core';
import {
  AiMark,
  Button,
  Chip,
  cn,
  MOTION_LABELS,
  SHOT_TYPE_LABELS,
  UserContent,
  useTimecode,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Move3d, ScanSearch, Type, Users } from 'lucide-react';
import { useCallback } from 'react';
import { shotAt, type ShotSpan } from '../clip-time';
import { useClockValue, type ClipClock } from '../player/clip-clock';
import { shotMark } from '../scrubber/shot-kinds';

const MS = { num: 1000, den: 1 } as const;

const FLAG_WORDS: Readonly<Record<QualityFlag, MessageDescriptor>> = {
  blurry: msg`Blurry`,
  dark: msg`Dark`,
  overexposed: msg`Too bright`,
  shaky: msg`Shaky`,
  flat: msg`Flat`,
  black: msg`Black frames`,
  frozen: msg`Frozen frames`,
};

function ShotBody({ span, count }: { span: ShotSpan; count: number }) {
  const { t, i18n } = useLingui();
  const timecode = useTimecode();
  const { shot } = span;
  const number = span.index + 1;
  const analysis = shot.analysis;
  const description = shot.description ?? analysis?.description?.text ?? null;
  const people = analysis?.description?.people ?? 0;
  const texts = [...new Set((analysis?.onScreenText ?? []).map((text) => text.text))];
  const flags = analysis?.quality.flags ?? [];
  return (
    <div className="flex min-w-0 animate-fade-in flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 id="clip-shot" className="m-0 text-base font-semibold text-ink">
          {t`Shot ${number} of ${count}`}
        </h2>
        <span className="font-mono text-xs text-ink-2 tabular-nums" data-slot="clip-shot-span">
          {timecode.clock(Math.round(span.from), MS)}–{timecode.clock(Math.round(span.to), MS)}
        </span>
        <Button asChild size="sm" variant="ghost" className="ms-auto">
          <Link to="/library" search={{ similar: shot.id }}>
            <ScanSearch aria-hidden />
            {t`Find similar`}
          </Link>
        </Button>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t`About this shot`}>
        {shot.shotType ? (
          <li>
            <Chip>
              <span aria-hidden className={cn('size-1.5 rounded-pill', shotMark(shot.shotType))} />
              {i18n._(SHOT_TYPE_LABELS[shot.shotType])}
            </Chip>
          </li>
        ) : null}
        {shot.motion ? (
          <li>
            <Chip>
              <Move3d aria-hidden />
              {i18n._(MOTION_LABELS[shot.motion])}
            </Chip>
          </li>
        ) : null}
        {people > 0 ? (
          <li>
            <Chip className="bg-rose-soft text-rose-strong">
              <Users aria-hidden />
              {t`${plural(people, { one: 'One person', other: '# people' })}`}
            </Chip>
          </li>
        ) : null}
        {flags.map((flag) => (
          <li key={flag}>
            <Chip tone="warning">{i18n._(FLAG_WORDS[flag])}</Chip>
          </li>
        ))}
      </ul>
      {description ? (
        <p className="m-0 flex items-start gap-2 text-sm text-ink">
          <AiMark className="mt-0.5 size-3.5 shrink-0" label={t`Described by Taalcut`} />
          <UserContent translate="no" className="max-w-[60ch]">
            {description}
          </UserContent>
        </p>
      ) : (
        <p className="m-0 text-sm text-ink-3">{t`Not described yet`}</p>
      )}
      {texts.length > 0 ? (
        <div className="flex items-start gap-2" data-slot="clip-shot-text">
          <Type aria-hidden className="mt-0.5 size-3.5 shrink-0 text-violet-strong" />
          <ul aria-label={t`Text on screen`} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {texts.map((text) => (
              <li key={text}>
                <UserContent
                  translate="no"
                  className="rounded-sm bg-violet-soft px-1.5 py-px text-xs font-semibold text-violet-strong"
                >
                  {text}
                </UserContent>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ClipShotNow({ spans, clock }: { spans: readonly ShotSpan[]; clock: ClipClock }) {
  const select = useCallback((at: number) => shotAt(spans, at)?.index ?? -1, [spans]);
  const index = useClockValue(clock, select);
  const span = spans[index];
  if (!span) return null;
  // A new shot fades in where the last one was (keyed, so the fade plays once a shot).
  return (
    <section aria-labelledby="clip-shot" data-slot="clip-shot-detail">
      <ShotBody key={span.shot.id} span={span} count={spans.length} />
    </section>
  );
}
