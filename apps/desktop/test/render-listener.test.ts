// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A2 end to end: render's sound checks on what audio's listen service hears in a rendered mix (AAC in MP4, as
 * an export's), the service the jobs process runs (LISTEN_EXTENSIONS with lane A's realness and critique). A mix
 * with an effect planted on each cut passes soundOnCuts; the same mix 120 ms late fails and names the cuts with
 * their offsets; a planted click fails soundClean at its time; soundCritique only warns. The render process's own
 * listener sends one `audio.listen.analyse` job per hearing as the export's child and opens no session itself.
 * With the models (TAALCUT_EAR1_MODELS) it also measures what listening adds to QA on a 60 s render.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, RationalTime, type RenderListening } from '@taalcut/core';
import { createListenService, directoryListenFiles, type ListenService } from '@taalcut/audio';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { soundCleanCheck, soundCritiqueCheck, soundOnCutsCheck } from '@taalcut/render';
import { afterAll, describe, expect, it } from 'vitest';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('render listener');
const MODELS = process.env.TAALCUT_EAR1_MODELS?.replace(/^~(?=\/)/, process.env.HOME ?? '~');
const root = mkdtempSync(join(tmpdir(), 'taalcut-render-listener-'));
const services: ListenService[] = [];
afterAll(async () => {
  for (const service of services) await service.release();
  rmSync(root, { recursive: true, force: true });
});

const SR = 48_000;
const FPS = 30;
const RATE = { num: FPS, den: 1 };
/** 16 cuts on frames, 0.9–1.5 s apart. */
const CUT_FRAMES = [27, 63, 90, 132, 165, 204, 231, 270, 306, 333, 378, 405, 444, 480, 513, 549];
const CLICK_S = 8.4321;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 1_073_741_824 - 1;
  };
}

/** A pad bed with a noise hit (2 ms attack, 30 ms decay) `lateS` after each cut, and a click when asked. */
function mix(seconds: number, cutFrames: readonly number[], lateS: number, click: boolean): Float32Array[] {
  const n = Math.round(seconds * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const noise = rng(11);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bed = 0.03 * Math.sin(2 * Math.PI * 220 * t) + 0.02 * Math.sin(2 * Math.PI * 330 * t);
    left[i] = bed + 0.002 * noise();
    right[i] = 0.9 * bed + 0.002 * noise();
  }
  for (const frame of cutFrames) {
    const start = Math.round((frame / FPS + lateS) * SR);
    for (let k = 0; k < 0.25 * SR && start + k < n; k++) {
      const env = Math.min(1, k / (0.002 * SR)) * Math.exp(-k / (0.03 * SR));
      const v = 0.5 * env * noise();
      left[start + k] = (left[start + k] ?? 0) + v;
      right[start + k] = (right[start + k] ?? 0) + v;
    }
  }
  if (click) {
    const at = Math.round(CLICK_S * SR);
    left[at] = (left[at] ?? 0) + 0.45;
    right[at] = (right[at] ?? 0) + 0.45;
  }
  return [left, right];
}

/** A float WAV of two channels. */
function wav(path: string, channels: readonly Float32Array[]): void {
  const frames = channels[0]?.length ?? 0;
  const data = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) {
    data.writeFloatLE(channels[0]?.[i] ?? 0, i * 8);
    data.writeFloatLE(channels[1]?.[i] ?? 0, i * 8 + 4);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

/** The mix as an export carries it: AAC in an MP4. */
async function render(media: MediaContext, name: string, channels: readonly Float32Array[]): Promise<string> {
  const source = join(root, `${name}.wav`);
  wav(source, channels);
  const out = join(root, `${name}.mp4`);
  const encoded = await runFfmpeg(media, ['-y', '-i', source, '-c:a', 'aac', '-b:a', '256k', out]);
  if (!encoded.ok) throw new Error(encoded.error.detail ?? encoded.error.code);
  return out;
}

const cuts = CUT_FRAMES.map((frame, i) => ({ frame, to: `clip${i + 1}` }));
const planned = new Set(CUT_FRAMES.map((_, i) => i));
/** Each effect clip from its cut, 8 frames long. */
const effects = CUT_FRAMES.map((frame) => ({ start: frame, end: frame + 8 }));

describe.skipIf(!resolved.ok)('render’s sound checks on what the listen service hears (EAR1-A2)', () => {
  const media = (): MediaContext => ({ binaries: resolved.ok ? resolved.value : (undefined as never) });
  const service = createListenService({ media: async () => ok(media()) });
  services.push(service);
  const hear = async (file: string): Promise<RenderListening> => {
    const heard = await service.listener.hearRender({
      file,
      cuts: CUT_FRAMES.map((frame) => RationalTime.of(frame, RATE)),
      frameRate: RATE,
      profile: 'launch',
    });
    if (!heard.ok) throw new Error(heard.error.detail ?? heard.error.code);
    return heard.value;
  };

  it(
    'passes planted hits, fails them 120 ms late naming the cuts, and fails a planted click',
    { timeout: 120_000 },
    async () => {
      const planted = await hear(await render(media(), 'planted', mix(20, CUT_FRAMES, 0, false)));
      expect(soundOnCutsCheck({ cutSync: planted.cutSync, cuts, planned }).status).toBe('pass');
      expect(soundCleanCheck({ audit: planted.audit, effects, fps: FPS }).status).toBe('pass');

      const late = await hear(await render(media(), 'late', mix(20, CUT_FRAMES, 0.12, false)));
      const shifted = soundOnCutsCheck({ cutSync: late.cutSync, cuts, planned });
      expect(shifted.status).toBe('fail');
      const named = shifted.findings.filter((f) => Math.abs((f.measured?.value ?? 0) - 120) <= 5);
      expect(named.length).toBeGreaterThanOrEqual(Math.ceil(0.9 * CUT_FRAMES.length));
      for (const f of named) expect(CUT_FRAMES).toContain(f.frames?.start);

      const clicked = await hear(await render(media(), 'click', mix(20, CUT_FRAMES, 0, true)));
      const clean = soundCleanCheck({ audit: clicked.audit, effects, fps: FPS });
      expect(clean.status).toBe('fail');
      expect(clean.findings.some((f) => Math.abs((f.measured?.value ?? 0) - CLICK_S * 1000) <= 5)).toBe(true);

      // Without models there is no critique; with one it only ever warns.
      expect(soundCritiqueCheck({ critique: planted.critique, fps: FPS }).status).not.toBe('fail');
    },
  );

  it.skipIf(!MODELS)(
    'hears a 60 s render with the models in the time render’s QA budget assumes',
    { timeout: 300_000 },
    async () => {
      const withModels = createListenService({
        media: async () => ok(media()),
        files: directoryListenFiles(MODELS ?? '', 'fp16'),
      });
      services.push(withModels);
      const frames = Array.from({ length: 48 }, (_, i) => 30 + i * 37);
      const file = await render(media(), 'sixty', mix(60, frames, 0, false));
      const request = {
        path: file,
        want: { measures: true, events: true, audit: true, realness: true },
        cuts: frames.map((frame) => RationalTime.of(frame, RATE)),
        frameRate: RATE,
        critique: { profile: 'launch' as const },
        install: false,
        optionalModels: true,
      };
      // The first hearing opens the sessions (once per jobs process); a render's QA pays the warm one.
      const cold = performance.now();
      const first = await withModels.analyse({ ...request, contentHash: 'cold' });
      const coldMs = performance.now() - cold;
      const warm = performance.now();
      const second = await withModels.analyse({ ...request, contentHash: 'warm' });
      const warmMs = performance.now() - warm;
      if (!first.ok || !second.ok) throw new Error('the 60 s render was not heard');
      expect(second.value.critique).not.toBeNull();
      expect(second.value.realness).not.toBeNull();
      console.warn(
        `[A2 hearing, 60 s render, fp16] cold ${Math.round(coldMs)} ms, warm ${Math.round(warmMs)} ms`,
      );
      // render's sound-listening.bench overlaps this with QA's other passes (4.4–6.4 s measured here: +0.8–2.8 s on QA).
      expect(warmMs).toBeLessThanOrEqual(8000);
    },
  );
});
