// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A preview session's sound (SPEC section 7, P3.9): the export's mix (clips by role, the music path including
 * generated music, ducked under the voice by audio's planner, speech joins) rendered once and encoded to AAC with
 * a one-pass loudnorm (exports do the exact two-pass mix), so preview sound is export sound: the reel's own music
 * (path d, REF1) included, so cutting to the beat is heard. Music the timeline can't use now (a missing track, a
 * reel no longer kept) is left out rather than failing the preview.
 */
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type AssetId, type Timeline } from '@taalcut/core';
import { runFfmpeg } from '@taalcut/media';
import { renderExportMix, type ExportMixInput } from '../audio/export-mix';
import { planAudioMix, type AudioSourceMap } from '../audio/mix-plan';
import { audioRoles } from '../audio/roles';
import { hasSpeech, transcriptsOf } from '../captions/transcripts';
import { musicPreflight, musicSources } from '../music/paths';
import { NO_REFERENCE_AUDIO } from '../music/reference-audio';
import type { RenderPlan } from '../plan/types';
import type { RenderEngineDeps } from './deps';
import { playableFile } from './playable-file';

const PREVIEW_AUDIO_KBPS = 128;

/** The current preview mix, by the key of what it was made from. */
export interface PreviewMix {
  readonly key: string;
  readonly file: string;
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** The export mix's input for a preview: what is playable now. */
async function previewMixInput(
  deps: RenderEngineDeps,
  plan: RenderPlan,
  timeline: Pick<Timeline, 'tracks' | 'mix'>,
): Promise<ExportMixInput> {
  const files = new Map<string, string>();
  for (const clip of plan.audio) {
    const file = await playableFile(deps.assets, clip.assetId, true);
    if (file) files.set(clip.id, file);
  }
  const music = await musicPreflight(plan.music, {
    referenceAudio: deps.referenceAudio ?? NO_REFERENCE_AUDIO,
    ownTrackPath: async (assetId) => ok(await playableFile(deps.assets, assetId, false)),
    ...(deps.generatedMusic ? { generatedMusic: deps.generatedMusic } : {}),
  });
  const sources: AudioSourceMap = {
    clip: (id) => {
      const clip = plan.audio.find((candidate) => candidate.id === id);
      const path = files.get(id);
      return clip && path ? { path, offset: clip.sourceIn } : undefined;
    },
    ...(music.ok ? musicSources(music.value) : {}),
  };
  const transcripts = deps.transcripts
    ? await transcriptsOf(
        deps.transcripts,
        plan.audio.map((clip) => clip.assetId),
      )
    : null;
  const speaking = transcripts?.ok
    ? new Set([...transcripts.value].filter(([, found]) => hasSpeech(found)).map(([id]) => id))
    : null;
  return {
    plan: {
      ...plan,
      audio: plan.audio.filter((clip) => files.has(clip.id)),
      music: music.ok ? plan.music : { path: 'platformSound' },
    },
    roles: audioRoles(timeline),
    mix: timeline.mix,
    sources,
    ...(deps.ducking ? { ducking: deps.ducking } : {}),
    ...(speaking ? { speech: (assetId: AssetId) => speaking.has(assetId) } : {}),
  };
}

/** The preview's AAC, or the previous one when nothing it is made from changed; null when there is nothing to hear. */
export async function previewMix(
  deps: RenderEngineDeps,
  plan: RenderPlan,
  timeline: Pick<Timeline, 'tracks' | 'mix'>,
  dir: string,
  previous: PreviewMix | null,
): Promise<PreviewMix | null> {
  const input = await previewMixInput(deps, plan, timeline);
  const mix = planAudioMix(input.plan, input.sources);
  if (!mix.ok || mix.value.silent) return null;
  const ducking = deps.ducking ? timeline.mix.ducking : null;
  const key = sha(JSON.stringify([mix.value.totalSamples, mix.value.segments, ducking])).slice(0, 40);
  if (previous?.key === key) return previous;
  const mixDir = join(dir, '.mix');
  await mkdir(mixDir, { recursive: true });
  const wav = join(mixDir, `${key}.wav`);
  const file = join(mixDir, `${key}.m4a`);
  try {
    const rendered = await renderExportMix(input, deps.media, { out: wav, workDir: mixDir });
    if (!rendered.ok || !rendered.value) return null;
    const encoded = await runFfmpeg(
      deps.media,
      [
        '-y',
        '-i',
        rendered.value.path,
        '-af',
        'loudnorm=I=-14:TP=-1.5:LRA=20,aresample=48000',
        '-c:a',
        'aac',
        '-b:a',
        `${PREVIEW_AUDIO_KBPS}k`,
        '-ac',
        '2',
        file,
      ],
      // Sound only: no video session (IX3-K2).
      { holdsVideoSession: false, timeoutMs: 10 * 60_000 },
    );
    if (!encoded.ok) return null;
  } finally {
    await rm(wav, { force: true });
  }
  if (previous) await rm(previous.file, { force: true });
  return { key, file };
}
