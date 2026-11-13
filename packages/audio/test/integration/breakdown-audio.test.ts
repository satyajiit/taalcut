// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Golden labels are checked with classifyAudio. A silent reel is measured when ffmpeg exists.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MediaContext } from '@taalcut/media';
import { buildSyntheticReel } from '@taalcut/media/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testMedia } from '../helpers/ffmpeg';
import { classifyAudio } from '../../src/measure/classify';
import { measureAudio } from '../../src/measure/measure';
import type { AudioEvidence } from '../../src/measure/types';
import { GOLDEN_AUDIO_LABELS } from '../../src/measure/labels';

const loud: AudioEvidence = { speechRatio: 0, musicScore: 0, integratedLufs: -18, nonSilentRatio: 0.9 };

describe('breakdown audio labels (not a beat-model gate)', () => {
  let ctx: MediaContext | undefined;
  let dir = '';

  beforeAll(async () => {
    const media = await testMedia('breakdown-audio');
    if (!media.ctx) {
      console.warn(media.skip);
      return;
    }
    ctx = media.ctx;
    dir = await mkdtemp(join(tmpdir(), 'taalcut-breakdown-'));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('maps hand-built evidence onto the golden speech, mixed, ambience and music labels', () => {
    const speech = classifyAudio({ ...loud, speechRatio: 0.5, musicScore: 0.1 });
    const mixed = classifyAudio({ ...loud, speechRatio: 0.4, musicScore: 0.7 });
    const ambience = classifyAudio({ ...loud, speechRatio: 0.05, musicScore: 0.2 });
    const music = classifyAudio({ ...loud, speechRatio: 0.05, musicScore: 0.8 });
    expect(speech.kind).toBe('voice');
    expect(GOLDEN_AUDIO_LABELS[speech.kind]).toBe('speech');
    expect(mixed.kind).toBe('mixed');
    expect(GOLDEN_AUDIO_LABELS[mixed.kind]).toBe('mixed');
    expect(ambience.kind).toBe('original');
    expect(GOLDEN_AUDIO_LABELS[ambience.kind]).toBe('ambience');
    expect(music.kind).toBe('music');
    expect(GOLDEN_AUDIO_LABELS[music.kind]).toBe('music');
    expect(music.transcriptDropped).toBe('music');
    expect(speech.transcriptDropped).toBeUndefined();
  });

  it('measures a silent reel as silent when ffmpeg exists', async () => {
    if (!ctx) return;
    const path = join(dir, 'silence.mp4');
    const written = await buildSyntheticReel(
      { width: 64, height: 64, fps: 25, frames: 50, silence: true },
      ctx,
      { out: path },
    );
    expect(written.ok, written.ok ? '' : (written.error.detail ?? written.error.code)).toBe(true);
    if (!written.ok) return;
    const measured = await measureAudio(path, undefined, ctx);
    expect(measured.ok, measured.ok ? '' : (measured.error.detail ?? measured.error.code)).toBe(true);
    if (!measured.ok) return;
    const classified = classifyAudio({
      speechRatio: 0,
      musicScore: 0,
      integratedLufs: measured.value.integratedLufs,
      nonSilentRatio: measured.value.nonSilentRatio,
    });
    expect(classified.kind).toBe('silent');
    expect(classified.silent).toBe(true);
    expect(GOLDEN_AUDIO_LABELS[classified.kind]).toBe('silence');
  }, 60_000);
});
