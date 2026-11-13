// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sound: clips from their originals (the mixer applies each clip's speed, and joins cleanup cuts with a
 * 12 ms crossfade), music by its path, ducked under the voice when the timeline asks (P3-V6, audio's planner),
 * mixed and normalised to the preset's loudness. A video clip whose file has no audio stream contributes
 * nothing. The planner's voice-over-music report goes to QA.
 */
import type { AssetId, AsyncResult } from '@taalcut/core';
import { mixExport, type ExportMixResult } from '../../audio/export-mix';
import { createAudioFallbackReporter } from '../../audio/loudness';
import { MIX_SAMPLE_RATE } from '../../audio/mix-plan';
import { audioRoles } from '../../audio/roles';
import { hasSpeech, transcriptsOf } from '../../captions/transcripts';
import { musicSources } from '../../music/paths';
import type { RenderPlan } from '../../plan/types';
import type { ExportInputs } from '../export-inputs';
import type { RenderedVideo } from '../render-video';
import type { StageContext } from './context';

/** What the mixer aims for: the preset's integrated loudness, 0.5 dB under its true-peak ceiling. */
export const mixTarget = (inputs: Pick<ExportInputs, 'preset'>) => ({
  integratedLufs: inputs.preset.loudness.integratedLufs,
  truePeakDbtp: inputs.preset.loudness.truePeakDbtp - 0.5,
});

/**
 * The assets whose sound carries speech (a transcript with words), so clip sound without speech mixes as
 * ambience, out of the voice the music ducks under. Undefined without a transcript source: all kept clip
 * sound counts as voice.
 */
async function speechAssets(
  stage: StageContext,
  inputs: ExportInputs,
): Promise<((assetId: AssetId) => boolean) | undefined> {
  const source = stage.deps.transcripts;
  if (!source) return undefined;
  const transcripts = await transcriptsOf(
    source,
    inputs.plan.audio.map((clip) => clip.assetId),
  );
  // Unreadable transcripts: all kept clip sound counts as voice, as without a source.
  if (!transcripts.ok) return undefined;
  const speaking = new Set([...transcripts.value].filter(([, found]) => hasSpeech(found)).map(([id]) => id));
  return (assetId) => speaking.has(assetId);
}

/** The plan's clips that sound: a video clip whose file has no audio stream contributes nothing. */
export const audibleClips = (plan: Pick<RenderPlan, 'audio'>, picture: RenderedVideo) =>
  plan.audio.filter(
    (clip) => picture.segments.get(clip.id)?.audio !== null || !picture.segments.has(clip.id),
  );

export async function mixSound(
  stage: StageContext,
  inputs: ExportInputs,
  picture: RenderedVideo,
  out: string,
): AsyncResult<ExportMixResult> {
  const plan = inputs.plan;
  const audio = audibleClips(plan, picture);
  const speech = await speechAssets(stage, inputs);
  return mixExport(
    {
      plan: { ...plan, audio },
      roles: audioRoles(inputs.timeline),
      mix: inputs.timeline.mix,
      sources: {
        clip: (id) => {
          const clip = audio.find((candidate) => candidate.id === id);
          const path = clip ? inputs.audioFiles.get(clip.assetId) : undefined;
          return clip && path ? { path, offset: clip.sourceIn } : undefined;
        },
        ...musicSources(inputs.music),
      },
      ...(stage.deps.ducking ? { ducking: stage.deps.ducking } : {}),
      ...(speech ? { speech } : {}),
    },
    stage.deps.media,
    {
      out,
      loudness: mixTarget(inputs),
      bitrateKbps: inputs.preset.audio.bitrateKbps,
      sampleRate: MIX_SAMPLE_RATE,
      signal: stage.signal,
      onProgress: (fraction) => stage.tracker.within(fraction),
      workDir: stage.workDir,
      reportFallback: createAudioFallbackReporter(stage.fallback, stage.deps.media.platform),
    },
  );
}
