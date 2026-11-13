// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-mood (EAR1-B3): each manifest track decoded as the jobs process decodes it, embedded with CLAP (earshot's
 * up to 6 evenly spaced 10 s windows) and calibrated against the vocabulary, as `music.findLibraryTrack`'s
 * `describe` does; a track passes when its labelled mood is among its three best `music_mood` hints. The bar is
 * `thresholds['listen-mood'].top3MoodRate` in tools/evals/ci-paths.json.
 */
import { readFileSync } from 'node:fs';
import {
  createListenModels,
  createListenSessions,
  createSoundIndex,
  decodeListenAudio,
  directoryListenFiles,
} from '@taalcut/audio';
import { z } from 'zod';
import paths from '../../../ci-paths.json' with { type: 'json' };
import { requireMediaBinaries } from '../../media-bin';
import { pickEnvironment } from '../predict';
import { fetchTrack } from './fetch';
import { moodManifestSchema, type MoodManifest } from './manifest';

export const MOOD_BAR = z
  .object({ thresholds: z.object({ 'listen-mood': z.object({ top3MoodRate: z.number().min(0).max(1) }) }) })
  .parse(paths).thresholds['listen-mood'];

export interface MoodCase {
  readonly id: string;
  readonly mood: string;
  readonly hints: readonly string[];
  readonly hit: boolean;
}

export interface MoodResult {
  readonly rate: number;
  readonly pass: boolean;
  readonly dtype: 'int8' | 'fp16';
  readonly cases: readonly MoodCase[];
}

export function readMoodManifest(path: string): MoodManifest {
  return moodManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export async function runMood(manifest: MoodManifest): Promise<MoodResult> {
  const env = pickEnvironment();
  const binaries = await requireMediaBinaries();
  const files = directoryListenFiles(env.models, env.dtype);
  const sessions = createListenSessions({ files });
  try {
    const models = createListenModels(sessions, files);
    const vocab = await models.text.vocab();
    if (!vocab.ok) throw new Error(vocab.error.code);
    const cases: MoodCase[] = [];
    for (const track of manifest.tracks) {
      const path = await fetchTrack(track);
      const decoded = await decodeListenAudio(path, { media: { binaries } });
      if (!decoded.ok) throw new Error(`${track.id}: ${decoded.error.code}`);
      const embedded = await models.clap.embedSource(decoded.value.samples);
      if (!embedded.ok) throw new Error(`${track.id}: ${embedded.error.code}`);
      // The hints don't depend on the query: any unit query scores them.
      const [hit] = createSoundIndex([{ id: track.id, embedding: embedded.value.pooled }]).score(
        embedded.value.pooled,
        vocab.value,
        { hints: ['music_mood'], hintsPer: 3 },
      );
      const hints = (hit?.hints?.music_mood ?? []).map((h) => h.term);
      cases.push({ id: track.id, mood: track.mood, hints, hit: hints.includes(track.mood) });
    }
    const rate = cases.filter((c) => c.hit).length / Math.max(1, cases.length);
    return { rate, pass: rate >= MOOD_BAR.top3MoodRate, dtype: env.dtype, cases };
  } finally {
    await sessions.release();
  }
}
