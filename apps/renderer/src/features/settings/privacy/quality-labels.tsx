// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: local-only quality labels · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · G27, P3-B10: where Local only makes a job simpler, or turns it off, said once in
 *   words beside the job, with an icon so it survives greyscale: simpler is a neutral chip (information); off is
 *   the warning chip, the one case where something you might reach for isn't there.
 * states: n/a (a label; it shows only while Local only is on and the models package reports a difference)
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { ModelModuleId, ModuleQuality } from '@taalcut/core';
import { Chip } from '@taalcut/ui';
import { CircleOff, Feather } from 'lucide-react';
import { jobName } from '../usage/usage-words';

/**
 * The models package's label keys (QUALITY_LABEL_KEYS, packages/models/src/privacy/quality-labels.ts) say why, not
 * which job: `models.quality.needsInternet` (Local only took every cloud model away) or `models.quality.notConfigured`
 * (no model is set up). The words come from the job and the quality, so each label reads on its own (first run lists
 * them without their jobs).
 */
const NOT_CONFIGURED = 'models.quality.notConfigured';

const SENTENCES: Record<ModelModuleId, { lowerQuality?: MessageDescriptor; unavailable: MessageDescriptor }> =
  {
    agent: {
      lowerQuality: msg({
        id: 'privacy.quality.agent.lowerQuality',
        message: 'The agent is simpler on this Mac',
      }),
      unavailable: msg({
        id: 'privacy.quality.agent.unavailable',
        message: 'The agent is off with Local only',
      }),
    },
    router: {
      unavailable: msg({
        id: 'privacy.quality.router.unavailable',
        message: 'Quick decisions are off with Local only',
      }),
    },
    vision: {
      lowerQuality: msg({
        id: 'privacy.quality.vision.lowerQuality',
        message: 'Descriptions are simpler on this Mac',
      }),
      unavailable: msg({
        id: 'privacy.quality.vision.unavailable',
        message: 'Descriptions are off with Local only',
      }),
    },
    embeddings: {
      unavailable: msg({
        id: 'privacy.quality.embeddings.unavailable',
        message: 'Clip search is off with Local only',
      }),
    },
    speech: {
      lowerQuality: msg({
        id: 'privacy.quality.speech.lowerQuality',
        message: 'Captions from speech are simpler on this Mac',
      }),
      unavailable: msg({
        id: 'privacy.quality.speech.unavailable',
        message: 'Captions from speech are off with Local only',
      }),
    },
    voice: {
      lowerQuality: msg({
        id: 'privacy.quality.voice.lowerQuality',
        message: 'Voice is simpler on this Mac',
      }),
      unavailable: msg({ id: 'privacy.quality.voice.unavailable', message: 'Voice is off with Local only' }),
    },
    music: {
      lowerQuality: msg({
        id: 'privacy.quality.music.lowerQuality',
        message: 'Generated music is simpler on this Mac',
      }),
      unavailable: msg({
        id: 'privacy.quality.music.unavailable',
        message: 'Generated music is off with Local only',
      }),
    },
    images: {
      lowerQuality: msg({
        id: 'privacy.quality.images.lowerQuality',
        message: 'Generated images are simpler on this Mac',
      }),
      unavailable: msg({
        id: 'privacy.quality.images.unavailable',
        message: 'Generated images are off with Local only',
      }),
    },
  };

const SAME = msg`Works the same on this Mac`;
const NO_MODEL = msg({ id: 'privacy.quality.job.notConfigured', message: '{job}: no model set up yet' });
const SIMPLER = msg({ id: 'privacy.quality.job.lowerQuality', message: '{job}: simpler on this Mac' });

export function qualityLabel(i18n: I18n, quality: ModuleQuality): string {
  if (quality.quality === 'full') return i18n._(SAME);
  const job = jobName(i18n, quality.module);
  if (quality.quality === 'unavailable' && quality.labelKey === NOT_CONFIGURED)
    return i18n._({ ...NO_MODEL, values: { job } });
  const sentence = SENTENCES[quality.module][quality.quality];
  return sentence ? i18n._(sentence) : i18n._({ ...SIMPLER, values: { job } });
}

/** The jobs Local only changes, from the privacy overview. */
export function changedJobs(quality: readonly ModuleQuality[]): ModuleQuality[] {
  return quality.filter((each) => each.quality !== 'full');
}

export function qualityFor(
  quality: readonly ModuleQuality[],
  module: ModelModuleId,
): ModuleQuality | undefined {
  return quality.find((each) => each.module === module && each.quality !== 'full');
}

/** One job's label beside it: "Lower quality on this Mac", "Needs the internet". */
export function QualityChip({ quality }: { quality: ModuleQuality }) {
  const { i18n } = useLingui();
  const off = quality.quality === 'unavailable';
  const Icon = off ? CircleOff : Feather;
  return (
    <Chip
      tone={off ? 'warning' : 'neutral'}
      data-quality={quality.quality}
      className="gap-1 whitespace-normal"
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      {qualityLabel(i18n, quality)}
    </Chip>
  );
}
