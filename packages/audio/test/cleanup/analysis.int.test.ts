// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, ok, RationalTime, TimeRange } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpeechCleanupAnalyser } from '../../src/cleanup/analysis';
import { analyzeSpeechAsset } from '../../src/cleanup/analyze-job';
import { createSpeechCleanupSource } from '../../src/cleanup/cleanup-source';
import { speechSegments, voicedIslands } from '../../src/cleanup/segments';
import { createSileroVad, type VadEngine } from '../../src/cleanup/vad';
import { decodeClipSpeech } from '../../src/pcm/decode';
import { testMedia } from '../helpers/ffmpeg';
import { HAS_SAY } from '../helpers/speech';
import { buildTalkingHead, type BuiltClip } from '../helpers/talking-head';

const MODEL = join(import.meta.dirname, '../../.cache/silero-vad/silero_vad.onnx');
const found = await testMedia('cleanup');
/** Needs Silero VAD v6.2.3 (the silero-vad component in .cache), FFmpeg and macOS's `say`; skips and says why. */
const skip = !existsSync(MODEL)
  ? `speech cleanup: skipped, Silero VAD v6.2.3 is needed at ${MODEL} (the silero-vad component)`
  : !found.ctx
    ? found.skip
    : !HAS_SAY
      ? 'speech cleanup: skipped, the clips are spoken with macOS say'
      : '';
if (skip) console.warn(skip);
let media: MediaContext;
let dir: string;
let vad: VadEngine;
let clip: BuiltClip;
const fallbacks: unknown[] = [];

const ms = (range: TimeRange) =>
  [RationalTime.toSeconds(range.start) * 1000, RationalTime.toSeconds(TimeRange.end(range)) * 1000] as const;

beforeAll(async () => {
  if (skip) return;
  media = found.ctx!;
  dir = await mkdtemp(join(tmpdir(), 'taalcut-cleanup-'));
  vad = createSileroVad({ modelPath: MODEL, onComputeFallback: (e) => fallbacks.push(e) });
  clip = await buildTalkingHead(media, dir, [
    { silenceMs: 400 },
    { say: 'So the thing about editing' },
    { silenceMs: 120 },
    { say: 'um' },
    { silenceMs: 650 },
    { say: 'is that the rhythm matters more than the cut, like, really' },
    { silenceMs: 260 },
    { say: 'um', transcribed: false, rate: 320, targetVoicedMs: 140 },
    { silenceMs: 260 },
    { say: 'Keep the music low' },
    { silenceMs: 500 },
    { say: 'Keep the music low and the voice clear' },
    { silenceMs: 300 },
  ]);
}, 180_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(Boolean(skip))('Silero VAD v6.2.3 (P3-V9)', () => {
  it('finds the speech of a say clip with edges within 64 ms', async () => {
    const pcm = await decodeClipSpeech(clip.path, media, { sampleRate: 16_000 });
    if (!pcm.ok) throw new Error(pcm.error.code);
    const activity = await vad.probabilities(pcm.value.channels[0] ?? new Float32Array());
    expect(activity.ok).toBe(true);
    if (!activity.ok) return;
    const segments = speechSegments(activity.value.probabilities, activity.value.windowMs);
    const phrase = clip.spans[1];
    if (!phrase) throw new Error('no phrase');
    const first = segments[0];
    expect(Math.abs((first?.startMs ?? 0) - phrase.startMs)).toBeLessThanOrEqual(64);
    // On the CPU provider, logged once: WebGPU gets Silero's recurrent state wrong (vad.ts).
    expect(activity.value.backend).toBe('cpu');
    expect(fallbacks).toEqual([
      expect.objectContaining({ operation: 'audio.vad', wanted: ['webgpu'], reason: 'unsupported_input' }),
    ]);
  });
});

describe.skipIf(Boolean(skip))('the speech cleanup analysis on a synthetic talking head (P3-V9)', () => {
  it('keeps the missed real-speech filler safely below the 250 ms detection boundary', async () => {
    const pcm = await decodeClipSpeech(clip.path, media, { sampleRate: 16_000 });
    if (!pcm.ok) throw new Error(pcm.error.code);
    const activity = await vad.probabilities(pcm.value.channels[0] ?? new Float32Array());
    if (!activity.ok) throw new Error(activity.error.code);
    const missed = clip.spans[7]!;
    const island = voicedIslands(activity.value.probabilities, activity.value.windowMs).find(
      (span) => span.startMs < missed.endMs && span.endMs > missed.startMs,
    );
    expect(island, 'the duration-controlled spoken um must remain detectable by real Silero').toBeDefined();
    const duration = island!.endMs - island!.startMs;
    expect(duration, 'the fixture must leave one VAD window of margin below 250 ms').toBeLessThan(224);
    expect(duration).toBeGreaterThanOrEqual(80);
  });

  it('finds every inserted pause and filler, the missed "um", the retake, and "like" only as ambiguous', async () => {
    const analyser = createSpeechCleanupAnalyser({ vad, media });
    const analysis = await analyser.analyse({
      path: clip.path,
      assetId: newId<'Asset'>(),
      contentHash: 'a'.repeat(64),
      transcript: clip.transcript,
    });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    const a = analysis.value;
    const pauses = a.pauses.map((p) => ms(p.range));
    for (const gap of clip.spans.filter(
      (s) =>
        'silenceMs' in s.part &&
        s.part.silenceMs >= 250 &&
        s.startMs > 0 &&
        s.endMs < clip.spans.at(-1)!.startMs,
    )) {
      expect(pauses.some(([start, end]) => start < gap.endMs && end > gap.startMs)).toBe(true);
    }
    const fillers = a.fillers.map((f) => ({ text: f.text, at: ms(f.range)[0] }));
    const transcribedUm = clip.spans[3];
    const missedUm = clip.spans[7];
    expect(fillers.some((f) => f.text === 'um' && Math.abs(f.at - (transcribedUm?.startMs ?? 0)) < 150)).toBe(
      true,
    );
    expect(fillers.some((f) => f.text === null && Math.abs(f.at - (missedUm?.startMs ?? 0)) < 150)).toBe(
      true,
    );
    expect(fillers.some((f) => f.text?.startsWith('like'))).toBe(false);
    expect(a.ambiguous.some((x) => a.words[x.wordIndex]?.text.startsWith('like'))).toBe(true);
    expect(a.retakes.map((r) => r.kind)).toContain('falseStart');
  });

  it('caches the analysis by content hash and config, and the source reads it back', async () => {
    const files = new Map<string, unknown>();
    const derived = {
      read: async (key: string) => ok(files.get(key) ?? null),
      write: async (key: string, json: unknown) => {
        files.set(key, json);
        return ok(undefined);
      },
    };
    const assetId = newId<'Asset'>();
    const hash = 'b'.repeat(64);
    const deps = {
      assets: { facts: async () => ok({ path: clip.path, contentHash: hash, transcript: clip.transcript }) },
      derived,
      analyser: createSpeechCleanupAnalyser({ vad, media }),
    };
    const first = await analyzeSpeechAsset(deps, assetId);
    expect(first.ok && first.value.reused).toBe(false);
    expect(first.ok && first.value.key).toBe(`speech/bb/${hash}.cfg1.v1.json`);
    const again = await analyzeSpeechAsset(deps, assetId);
    expect(again.ok && again.value.reused).toBe(true);
    const source = createSpeechCleanupSource({ assets: { contentHash: async () => ok(hash) }, derived });
    const read = await source.get(assetId);
    expect(read.ok && read.value?.contentHash).toBe(hash);
    const stale = createSpeechCleanupSource({
      assets: { contentHash: async () => ok('c'.repeat(64)) },
      derived,
    });
    expect((await stale.get(assetId)).ok && (await stale.get(assetId))).toEqual({ ok: true, value: null });
  });
});
