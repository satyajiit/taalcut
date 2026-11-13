// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-mood as a listening suite (EAR1-I3 over EAR1-B3). It needs a CC0 mood-labelled set (manifest.ts has the
 * format), which the owner provides: `TAALCUT_LISTEN_MOOD_MANIFEST`, else golden/listen-mood/manifest.json. Until one
 * is there the suite is skipped ("no labelled set"), as it is without the listen models or FFmpeg.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ffmpegHere, listenModelsHere } from '../../listening/environment';
import { outcomeOf, type ListenOutcome, type SkippedPart } from '../../listening/outcome';
import { readMoodManifest, runMood } from './run';

export const DEFAULT_MOOD_MANIFEST = join(import.meta.dirname, '../../../golden/listen-mood/manifest.json');

export function moodManifestPath(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.TAALCUT_LISTEN_MOOD_MANIFEST?.trim();
  return named ? resolve(named) : DEFAULT_MOOD_MANIFEST;
}

/** Why the suite can't run here, or undefined when it can. */
async function missing(manifest: string): Promise<SkippedPart | undefined> {
  if (!existsSync(manifest))
    return {
      part: 'tracks',
      reason: `no labelled set: no CC0 mood manifest at ${manifest} (TAALCUT_LISTEN_MOOD_MANIFEST)`,
    };
  const models = await listenModelsHere(['clapAudio', 'clapText']);
  if ('reason' in models) return { part: 'tracks', reason: models.reason };
  const ffmpeg = await ffmpegHere();
  if ('reason' in ffmpeg) return { part: 'tracks', reason: ffmpeg.reason };
  return undefined;
}

export async function runMoodSuite(): Promise<ListenOutcome> {
  const started = performance.now();
  const seconds = () => (performance.now() - started) / 1000;
  const manifest = moodManifestPath();
  const skip = await missing(manifest);
  if (skip) return outcomeOf('listen-mood', { metrics: [], skipped: [skip], seconds: seconds() });
  const result = await runMood(readMoodManifest(manifest));
  return outcomeOf('listen-mood', {
    metrics: [
      {
        name: 'top3MoodRate',
        value: result.rate,
        better: 'higher',
        part: 'tracks',
        over: `${result.cases.length} tracks, ${result.dtype}`,
      },
    ],
    notes: result.cases
      .filter((c) => !c.hit)
      .map((c) => `- ${c.id} (${c.mood}): ${c.hints.join(', ') || 'no hints'}`),
    seconds: seconds(),
  });
}
