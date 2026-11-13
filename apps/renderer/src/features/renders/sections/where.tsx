// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "Where it’s going" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the kit's PresetPicker list (each preset with its length limit and size; one that
 *   doesn't fit dimmed with why; the landscape and 4:3 canvases with them; the AV1 presets dimmed with why on a
 *   machine without a hardware AV1 encoder), the video format as a Segmented under it on a preset that offers
 *   more than one (H.264 the default, HEVC where the machine encodes it, LNX1-AV1), the estimate in tabular
 *   figures, and "Add the intro and outro" when the timeline's Style has them. A pick is saved as the project's
 *   (render.setExportPreset), so the agent's next export starts there too.
 * states: default · a preset or format this machine can't make (dimmed, its reason) · hover/focus/active (the
 *   picker's rows, the format, the switch) · disabled (while the export starts) · loading (the format or switch
 *   while it saves) · error (the cause in one line; the pick stays for this export) · success (silent: checked)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { FrameRate, RENDER_COMMANDS, type TaalcutError } from '@taalcut/core';
import { backendText, ErrorLine, LabelledSwitch, PresetPicker, Segmented, UserContent } from '@taalcut/ui';
import { useState } from 'react';
import { formatBytes } from '../../shared/format';
import { Duration } from '../../shared/time';
import { codecChoices, keptCodec, keptRate, rateChoices, rateKey } from './codec-choices';
import { SectionFrame, SectionNote } from './section-frame';
import type { ExportChoices, ExportSection, SectionProps } from './types';

const CODEC_WORDS = {
  h264: msg`H.264, plays everywhere`,
  hevc: msg`HEVC, smaller file`,
  av1: msg`AV1`,
} as const;
const NOT_HERE = msg`This computer can’t make it`;

function Where({ context, choices, choose, dispatch, disabled }: SectionProps) {
  const { t, i18n } = useLingui();
  const { options, style, projectId } = context;
  const [saving, setSaving] = useState<'preset' | 'codec' | 'bumpers' | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const selected =
    options.presets.find((entry) => entry.preset.id === choices.presetId) ?? options.presets[0];
  const bumpers = style !== null && (style.intro !== null || style.outro !== null);
  const styleName = style?.name ?? '';
  const size = selected ? formatBytes(i18n, selected.estimate.bytes) : '';
  const renderMs = selected?.estimate.renderMs ?? 0;

  const codecs = selected ? codecChoices(selected) : [];
  const codec = choices.codec ?? selected?.preset.video.codec ?? 'h264';
  const missing = codecs.find((choice) => !choice.available && choice.reasonKey);
  const sourceRate = context.timeline.canvas.rate;
  const rates = selected ? rateChoices(selected, sourceRate) : [sourceRate];
  const rate = choices.rate ?? sourceRate;
  const entryOf = (presetId: string) => options.presets.find((entry) => entry.preset.id === presetId);

  const save = async (patch: Partial<ExportChoices>, what: 'preset' | 'codec' | 'bumpers') => {
    const next = { ...choices, ...patch };
    // The codec the dialog shows, saved with the preset (its default when none was picked), so the project's
    // setting never keeps an earlier pick the dialog doesn't show.
    const shown = next.codec ?? entryOf(next.presetId)?.preset.video.codec;
    choose(patch);
    setSaving(what);
    setError(null);
    const result = await dispatch(RENDER_COMMANDS.setExportPreset, {
      projectId,
      timelineId: options.timelineId,
      presetId: next.presetId,
      ...(shown ? { codec: shown } : {}),
      captions: { burnIn: next.burnIn, sidecars: next.srt ? ['srt'] : [] },
      ...(bumpers ? { includeBumpers: next.includeBumpers } : {}),
    });
    setSaving(null);
    if (!result.ok) setError(result.error);
  };

  return (
    <SectionFrame id="where" title={t`Where it’s going`}>
      <PresetPicker
        variant="list"
        value={choices.presetId}
        disabled={disabled}
        onChange={(presetId) =>
          void save(
            {
              presetId,
              codec: keptCodec(entryOf(presetId), choices.codec),
              rate: keptRate(entryOf(presetId), sourceRate, choices.rate),
            },
            'preset',
          )
        }
        options={options.presets.map((entry) => ({
          id: entry.preset.id,
          available: entry.available,
          reasonKey: entry.reasonKey,
          maxSeconds: entry.preset.duration.maxSeconds,
          estimateBytes: entry.estimate.bytes,
        }))}
      />
      {codecs.length > 1 ? (
        <div className="flex flex-col gap-1.5 pt-1">
          <Segmented
            label={t`Video format`}
            value={codec}
            options={codecs.map((choice) => ({
              value: choice.codec,
              label: i18n._(CODEC_WORDS[choice.codec]),
              disabled: !choice.available,
            }))}
            onChange={(picked) => void save({ codec: picked }, 'codec')}
            disabled={disabled}
            busy={saving === 'codec'}
            className="self-start"
          />
          {missing?.reasonKey ? (
            <SectionNote>{backendText(i18n, missing.reasonKey, NOT_HERE)}</SectionNote>
          ) : null}
        </div>
      ) : null}
      {rates.length > 1 ? (
        <div className="flex flex-col gap-1.5 pt-1">
          <Segmented
            label={t`Frame rate`}
            value={rateKey(rate)}
            options={rates.map((candidate) => {
              const fps = i18n.number(Math.round(candidate.num / candidate.den));
              return {
                value: rateKey(candidate),
                label: t`${fps} frames a second`,
              };
            })}
            onChange={(picked) => {
              const found = rates.find((candidate) => rateKey(candidate) === picked);
              choose({ rate: found && !FrameRate.equals(found, sourceRate) ? found : undefined });
            }}
            disabled={disabled}
            className="self-start"
          />
        </div>
      ) : null}
      {selected ? (
        <SectionNote className="tabular-nums">
          <Trans>
            About {size}, about <Duration ms={renderMs} /> to make.
          </Trans>
        </SectionNote>
      ) : null}
      {bumpers ? (
        <div className="flex flex-col gap-1 pt-1">
          <LabelledSwitch
            checked={choices.includeBumpers}
            disabled={disabled}
            loading={saving === 'bumpers'}
            onChange={(includeBumpers) => void save({ includeBumpers }, 'bumpers')}
          >
            {t`Add the intro and outro`}
          </LabelledSwitch>
          <SectionNote className="ps-11">
            <Trans>
              From the Style <UserContent translate="no">{styleName}</UserContent>.
            </Trans>
          </SectionNote>
        </div>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
    </SectionFrame>
  );
}

export const whereSection: ExportSection = { id: 'where', available: () => true, Component: Where };
