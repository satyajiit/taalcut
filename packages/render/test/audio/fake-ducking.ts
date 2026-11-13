// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for audio's DuckingPlanner (core port) for render's tests: render may not import @taalcut/audio.
 * `plan` ducks the music to the floor wherever voice is within 3 s (so every short-term window that counts is
 * ducked whole), with the attack and release as ramps. `check` measures what the real check measures: EBU
 * R128 short-term loudness (3 s) of the dry voice and the ducked music every 100 ms, with FFmpeg's ebur128,
 * counting the frames whose window holds at least 1.5 s of voice.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type DuckingPlanner, type GainPoint, type VoiceOverMusicReport } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { ffmpeg } from '../support/media';
import { decodePcm } from './helpers';

const RATE = 48_000;
const BLOCK = 480; // 10 ms
const FRAME_BLOCKS = 10; // 100 ms

/** Which 10 ms blocks hold voice: RMS above 5 % of the loudest block's. */
async function voicedBlocks(ctx: MediaContext, path: string): Promise<boolean[]> {
  const pcm = await decodePcm(ctx, path);
  const levels: number[] = [];
  for (let start = 0; start < pcm.length; start += BLOCK) {
    let sum = 0;
    const end = Math.min(pcm.length, start + BLOCK);
    for (let i = start; i < end; i++) sum += pcm[i]! * pcm[i]!;
    levels.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const loudest = Math.max(...levels);
  return levels.map((level) => level > loudest * 0.05);
}

/** Short-term loudness every 100 ms (at each 100 ms frame's end), from ebur128's frame metadata. */
async function shortTerm(ctx: MediaContext, path: string, dir: string, name: string): Promise<number[]> {
  const log = join(dir, `${name}.r128.txt`);
  await ffmpeg(ctx, [
    '-i',
    path,
    '-af',
    `asetnsamples=n=4800:p=0,ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.S:file=${log}`,
    '-f',
    'null',
    '-',
  ]);
  const text = await readFile(log, 'utf8');
  return [...text.matchAll(/lavfi\.r128\.S=(-?[0-9.]+|-inf)/g)].map((match) =>
    match[1] === '-inf' ? -120 : Number(match[1]),
  );
}

export interface FakeDucking extends DuckingPlanner {
  /** What `plan` was handed: each stem's length in samples, and the duration it was told. */
  readonly calls: { lengths: Record<string, number>; durationSamples: number }[];
}

export function fakeDuckingPlanner(ctx: MediaContext, dir: string): FakeDucking {
  const calls: FakeDucking['calls'] = [];
  return {
    calls,
    async plan(stems, settings) {
      const lengths: Record<string, number> = {};
      for (const [name, path] of Object.entries({
        voice: stems.voice,
        music: stems.music,
        effects: stems.effects,
      }))
        if (path) lengths[name] = (await decodePcm(ctx, path)).length;
      calls.push({ lengths, durationSamples: stems.durationSamples });
      const voiced = await voicedBlocks(ctx, stems.voice);
      // Duck wherever voice is within 3 s either side.
      const reach = 300;
      const ducked = voiced.map((_, index) =>
        voiced.slice(Math.max(0, index - reach), index + reach + 1).some(Boolean),
      );
      const attack = Math.round((settings.attackMs / 1000) * RATE);
      const release = Math.round((settings.releaseMs / 1000) * RATE);
      const points: GainPoint[] = [];
      for (let index = 0; index < ducked.length; index++) {
        const starts = ducked[index] && !ducked[index - 1];
        const ends = !ducked[index] && ducked[index - 1];
        if (starts) {
          const at = index * BLOCK;
          points.push({ sample: Math.max(0, at - attack), db: 0 }, { sample: at, db: settings.floorDb });
        }
        if (ends) {
          const at = index * BLOCK;
          points.push({ sample: at, db: settings.floorDb }, { sample: at + release, db: 0 });
        }
      }
      const music = stems.music ? points : [];
      const effects = stems.effects ? points : [];
      return ok({ music, effects });
    },
    async check(stems, marginLu) {
      const voiced = await voicedBlocks(ctx, stems.voice);
      const voice = await shortTerm(ctx, stems.voice, dir, 'voice');
      const music = await shortTerm(ctx, stems.duckedMusic, dir, 'music');
      const frames = Math.min(voice.length, music.length);
      const moments: VoiceOverMusicReport['worst'][number][] = [];
      for (let frame = 0; frame < frames; frame++) {
        const endBlock = (frame + 1) * FRAME_BLOCKS;
        const window = voiced.slice(Math.max(0, endBlock - 300), endBlock);
        if (window.filter(Boolean).length < 150) continue;
        moments.push({ atMs: (frame + 1) * 100, voiceLufs: voice[frame]!, musicLufs: music[frame]! });
      }
      const margins = moments.map((moment) => moment.voiceLufs - moment.musicLufs);
      const minMarginLu = margins.length > 0 ? Math.min(...margins) : null;
      const worst = [...moments]
        .sort((a, b) => a.voiceLufs - a.musicLufs - (b.voiceLufs - b.musicLufs))
        .slice(0, 3);
      return ok({
        frames,
        counted: moments.length,
        marginLu,
        minMarginLu,
        worst,
        passed: minMarginLu === null || minMarginLu >= marginLu,
      });
    },
  };
}
