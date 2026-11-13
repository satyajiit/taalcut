// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * loudness and silence on 10 s AAC files. The pass fixture gets a linear
 * gain to −14 LUFS measured from the tone itself, which is what the mixer's
 * second loudnorm pass amounts to on a steady signal; fail fixtures are
 * muxed directly, never through the mixer.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaContext } from '@taalcut/media';
import { presetFor } from '../../src/presets/presets.v1';
import { loudnessCheck, silenceCheck } from '../../src/qa/checks/audio';
import { measureAudioLevels, type AudioLevels } from '../../src/qa/measure/audio-pass';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { PASS_AUDIO, qaPlan } from './support';

const media = await findTestMedia('qa loudness');
const TONE = 'sine=f=440:r=48000:d=10';
const device = presetFor('device');
const voicePlan = qaPlan({ durationFrames: 300 });
const silentPlan = qaPlan({
  durationFrames: 300,
  audio: { silent: true, music: 'platformSound', referenceAudio: false, windows: [] },
});

describe.skipIf(!media.binaries)('loudness and silence', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const path = (name: string) => join(work.dir, `${name}.m4a`);
  const encode = (name: string, source: string, filter = 'anull') =>
    ffmpeg(ctx, ['-f', 'lavfi', '-i', source, '-af', filter, ...PASS_AUDIO, path(name)]);
  const levels = async (name: string): Promise<AudioLevels> => {
    const result = await measureAudioLevels(ctx, path(name));
    if (!result.ok) throw new Error(`${result.error.code} ${result.error.detail ?? ''}`);
    return result.value;
  };

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('qa-loudness');
    await encode('raw', TONE);
    const gain = -14 - (await levels('raw')).integratedLufs;
    await encode('normalised', TONE, `volume=${gain.toFixed(2)}dB`);
    await encode('quiet', TONE, `volume=${(gain - 10).toFixed(2)}dB`);
    // The −14 LUFS tone peaks near −13 dBFS; +15 dB in float (no s16 clip on the way) takes it over 0 dBTP.
    await encode('loud', TONE, `aformat=sample_fmts=fltp,volume=${(gain + 15).toFixed(2)}dB`);
    await encode('empty', 'anullsrc=r=48000:cl=stereo:d=10');
  });
  afterAll(() => work.dispose());

  it('passes a tone at −14 LUFS', async () => {
    const measured = await levels('normalised');
    expect(measured.integratedLufs).toBeCloseTo(-14, 0);
    const result = loudnessCheck(measured, voicePlan, device);
    expect(result.status).toBe('pass');
    expect(result.threshold).toEqual({ min: -15, max: -13, unit: 'lufs' });
    expect(silenceCheck(measured, voicePlan).status).toBe('pass');
  });

  it('fails the same tone 10 dB down, and renormalises', async () => {
    const result = loudnessCheck(await levels('quiet'), voicePlan, device);
    expect(result.status).toBe('fail');
    expect(result.measured!.value).toBeCloseTo(-24, 0);
    expect(result.findings.map((finding) => finding.target?.id)).toEqual(['integrated']);
    expect(result.fixes).toEqual([{ kind: 'auto', action: 'renormaliseAudio' }]);
    expect(result.overridable).toBe(true);
  });

  it('fails a true peak over −1 dBTP', async () => {
    const measured = await levels('loud');
    expect(measured.truePeakDbtp).toBeGreaterThan(-1);
    const result = loudnessCheck(measured, voicePlan, device);
    expect(result.status).toBe('fail');
    expect(result.findings.map((finding) => finding.target?.id)).toContain('truePeak');
  });

  it('skips loudness on a silent path-a export, and passes its silence', async () => {
    const measured = await levels('empty');
    // volumedetect measures on s16: digital silence reads as its floor, −91 dB.
    expect(measured.maxVolumeDb).toBeLessThanOrEqual(-90);
    expect(loudnessCheck(measured, silentPlan, device).status).toBe('skipped');
    expect(silenceCheck(measured, silentPlan).status).toBe('pass');
  });

  it('fails silence both ways: sound on a silent plan, and a mix that lost its sources', async () => {
    const unexpected = silenceCheck(await levels('normalised'), silentPlan);
    expect(unexpected.status).toBe('fail');
    expect(unexpected.findings[0]?.target?.id).toBe('unexpectedSound');
    expect(unexpected.overridable).toBe(false);
    const lost = silenceCheck(await levels('empty'), voicePlan);
    expect(lost.status).toBe('fail');
    expect(lost.findings[0]?.target?.id).toBe('lostSound');
    expect(lost.measured!.value).toBeLessThanOrEqual(-90);
    expect(loudnessCheck(await levels('empty'), voicePlan, device).status).toBe('fail');
  });
});
