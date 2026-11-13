// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the clip's facts (UX4; the camera and time rows LIB1-OEM, clip-capture.tsx) · mode: Operate · system:
 *   DESIGN.md v0.7 (ListRow, the icon registry, type roles)
 * four groups an editor reads at a glance, each a short heading in plain words over hairline-divided rows in one
 *   raised frame (ListRows framed, dense), every row led by its glyph: Picture (its size and shape, with the HDR
 *   mark and slow motion or time-lapse under it; frames a second, with the codec and bit depth, and its length at
 *   the row's end; how good Taalcut judged it, with the AI mark), Sound (what is heard: speech in a language, sound
 *   with no speech, or none; the music's tempo), When and where (the camera with its model number or lens and
 *   capture mode, the day and time where it was shot with its zone, or the day it was added, where it was and its
 *   trip: clip-place.tsx), File (its name, size and where it lives; Show in Finder under the
 *   frame). Values lead, in ink; the words that qualify them in ink-2. Numbers are tabular. "Not
 *   yet" in ink-3 where a step is still to come
 * states: filled · still being looked at ("Not yet") · photo (no frames or sound) · no sound · rows: not
 *   interactive (no hover, no focus) · Show in Finder: the Button's own (default, hover, focus, active, loading while
 *   main finds the file, error with the cause under it, success silent: Finder comes forward) · disabled n/a
 * motion: none of its own (the inspector's cascade brings it in)
 * contrast: values ink ≥ 7:1, qualifiers ink-2 ≥ 7:1, "Not yet" ink-3 ≥ 4.5:1; icons are labelled by their words */
import { useLingui } from '@lingui/react/macro';
import { callRpc, type AssetDetail, type TaalcutError } from '@taalcut/core';
import { AiMark, Button, ErrorLine, ListRows, UserContent, VERB_ICONS } from '@taalcut/ui';
import {
  AudioLines,
  FileVideoCamera,
  Film,
  Image as ImageIcon,
  Music,
  RectangleHorizontal,
  RectangleVertical,
  Square,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useBackend } from '../../../../backend/backend';
import { formatBytes, formatClipLength } from '../../../shared/format';
import { framesPerSecond, pending, soundOf } from '../clip-facts-data';
import { clipLength } from '../clip-time';
import { ClipCamera, ClipWhen } from './clip-capture';
import { ClipLanguage } from './clip-language';
import { ClipPlace } from './clip-place';
import { codecName, HDR_MARKS, qualityWord, SHAPE_WORDS } from './fact-words';
import { Fact, Lead, Mark } from './fact-row';

const SHAPE_ICONS = { portrait: RectangleVertical, landscape: RectangleHorizontal, square: Square } as const;

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2" data-slot="clip-facts-group">
      <h3 id={id} className="m-0 type-label-sm text-ink-2">
        {title}
      </h3>
      <ListRows framed aria-labelledby={id}>
        {children}
      </ListRows>
    </section>
  );
}

function ShowInFinder({ detail }: { detail: AssetDetail }) {
  const { t } = useLingui();
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const present = detail.locations.some((location) => location.state === 'present');
  if (!present) return null;
  const reveal = async () => {
    setBusy(true);
    const result = await callRpc(backend.files.revealAsset({ assetId: detail.asset.id }));
    setBusy(false);
    setError(result.ok ? null : result.error);
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="ghost"
        icon={VERB_ICONS.reveal}
        className="-ms-3"
        loading={busy}
        status={error ? 'error' : undefined}
        onClick={() => void reveal()}
      >
        {t`Show in Finder`}
      </Button>
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}

export function ClipFacts({ detail }: { detail: AssetDetail }) {
  const { t, i18n } = useLingui();
  const { asset, facts } = detail;
  const notYet = <span className="text-ink-3">{t`Not yet`}</span>;
  const photo = asset.kind === 'image';
  const width = facts?.width ?? asset.width;
  const height = facts?.height ?? asset.height;
  const fps = facts?.frameRate ? i18n.number(framesPerSecond(facts.frameRate)) : null;
  const factor = facts ? i18n.number(facts.speedFactor, { maximumFractionDigits: 1 }) : null;
  const videoCodec = codecName(facts?.videoCodec);
  const audioCodec = codecName(facts?.audioCodec);
  const hdr = facts ? HDR_MARKS[facts.hdr] : null;
  const sound = soundOf(detail);
  const bpm = detail.beats?.bpm ? i18n.number(Math.round(detail.beats.bpm)) : null;
  const location = detail.locations[0];
  const bits = facts?.bitDepth ? i18n.number(facts.bitDepth) : null;
  const speed = facts && facts.speed !== 'normal' ? facts.speed : null;
  const codecWords = [videoCodec, bits ? t`${bits}-bit` : null].filter(Boolean).join(' · ');

  return (
    <section aria-labelledby="clip-facts" data-slot="clip-facts" className="flex flex-col gap-5">
      <h2 id="clip-facts" className="sr-only">{t`About this clip`}</h2>
      <Group id="clip-facts-picture" title={t`Picture`}>
        <Fact
          leading={asset.orientation ? SHAPE_ICONS[asset.orientation] : ImageIcon}
          title={
            width && height ? (
              <span className="tabular-nums">{`${i18n.number(width)} × ${i18n.number(height)}`}</span>
            ) : (
              notYet
            )
          }
          meta={asset.orientation ? i18n._(SHAPE_WORDS[asset.orientation]) : undefined}
        >
          {hdr || speed ? (
            <span className="flex flex-wrap items-center gap-1.5 pt-1">
              {hdr ? (
                <Mark strong>
                  <span translate="no">{hdr}</span>
                </Mark>
              ) : null}
              {speed ? (
                <Mark>
                  {speed === 'slow-motion'
                    ? t`Slow motion, ${factor}× slower`
                    : t`Time-lapse, ${factor}× faster`}
                </Mark>
              ) : null}
            </span>
          ) : null}
        </Fact>
        {photo ? null : (
          <Fact
            leading={Film}
            title={
              fps ? (
                <span className="tabular-nums">
                  {facts?.variableFrameRate ? t`${fps} frames a second, variable` : t`${fps} frames a second`}
                </span>
              ) : (
                notYet
              )
            }
            meta={codecWords ? <span translate="no">{codecWords}</span> : undefined}
            trailingMeta={
              asset.duration ? (
                <span className="tabular-nums">{formatClipLength(i18n, clipLength(detail) / 1000)}</span>
              ) : undefined
            }
          />
        )}
        {asset.quality !== null ? (
          <Fact
            leading={
              <Lead>
                <AiMark className="size-3.5 shrink-0" label={t`Judged by Taalcut`} />
              </Lead>
            }
            title={i18n._(qualityWord(asset.quality))}
            meta={t`How Taalcut judged its picture`}
          />
        ) : null}
      </Group>
      {photo ? null : (
        <Group id="clip-facts-sound" title={t`Sound`}>
          {sound === 'speech' ? (
            <ClipLanguage detail={detail} codec={audioCodec} />
          ) : (
            <Fact
              leading={
                <Lead>
                  <AudioLines aria-hidden className="size-4 text-teal-strong" />
                </Lead>
              }
              title={
                sound === 'silent' ? (
                  t`No sound`
                ) : sound === 'sound' ? (
                  t`Sound, no speech`
                ) : audioCodec ? (
                  <span translate="no">{audioCodec}</span>
                ) : (
                  t`Sound`
                )
              }
              meta={
                sound === 'silent' ? undefined : sound === 'unknown' && pending(detail, 'audio.') ? (
                  <span className="text-ink-3">{t`Not listened to yet`}</span>
                ) : audioCodec ? (
                  <span translate="no">{audioCodec}</span>
                ) : undefined
              }
            />
          )}
          {bpm ? (
            <Fact leading={Music} title={t`Music at ${bpm} BPM`} meta={t`With its beats marked`} />
          ) : null}
        </Group>
      )}
      <Group id="clip-facts-capture" title={t`When and where`}>
        <ClipCamera detail={detail} />
        <ClipWhen detail={detail} />
        <ClipPlace detail={detail} />
      </Group>
      <div className="flex flex-col gap-2">
        <Group id="clip-facts-file" title={t`File`}>
          <Fact
            leading={FileVideoCamera}
            title={
              <UserContent translate="no" className="break-all">
                {asset.name}
              </UserContent>
            }
            meta={
              <span className="flex flex-wrap gap-x-1.5">
                <span className="tabular-nums">{formatBytes(i18n, detail.sizeBytes)}</span>
                {location ? (
                  <>
                    <span aria-hidden>·</span>
                    <UserContent translate="no">{location.sourceName}</UserContent>
                  </>
                ) : null}
              </span>
            }
          />
        </Group>
        <ShowInFinder detail={detail} />
      </div>
    </section>
  );
}
