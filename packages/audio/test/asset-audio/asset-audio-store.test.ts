// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The per-asset audio pass store: one pass shared, kept for a later stage, and nothing left behind (IX-A1). */
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAssetAudioStore } from '../../src/asset-audio/asset-audio-store';
import { audioPlan, fakePassFfmpeg } from '../helpers/audio-pass';

let parent = '';

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'taalcut-asset-audio-'));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const asset = { path: '/clips/a.mov', contentHash: 'a'.repeat(64), plan: audioPlan(2000) };

describe('asset audio store', () => {
  it('runs one pass for two callers at once and reads the loudness, silences and PCM from it', async () => {
    const ffmpeg = fakePassFfmpeg({ frames: 32_000 });
    const store = createAssetAudioStore({ parent });
    const [a, b] = await Promise.all([store.acquire(asset, ffmpeg.ctx), store.acquire(asset, ffmpeg.ctx)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(ffmpeg.calls()).toBe(1);
    expect(a.value.pass.loudness).toEqual({ integratedLufs: -21.4, loudnessRange: 3.2, truePeakDbtp: -2.5 });
    expect(a.value.pass.silences).toEqual([{ startMs: 500, endMs: 1250 }]);
    expect(a.value.pass.pcm).toMatchObject({ frames: 32_000, durationMs: 2000, dataOffset: 44 });
    await a.value.release();
    expect(await exists(a.value.dir)).toBe(true);
    await b.value.release();
    expect(await exists(a.value.dir)).toBe(false);
    expect(store.stats()).toMatchObject({ passes: 1, entries: 0 });
  });

  it('keeps the pass for a later stage and removes it when that stage is done', async () => {
    const ffmpeg = fakePassFfmpeg();
    const store = createAssetAudioStore({ parent });
    const language = await store.acquire(asset, ffmpeg.ctx);
    if (!language.ok) throw new Error(language.error.code);
    await language.value.release({ keep: true });
    expect(await exists(join(language.value.dir, 'speech.wav'))).toBe(true);
    const transcript = await store.acquire(asset, ffmpeg.ctx);
    if (!transcript.ok) throw new Error(transcript.error.code);
    expect(ffmpeg.calls()).toBe(1);
    expect(store.stats().reused).toBe(1);
    await transcript.value.release();
    expect(await exists(language.value.dir)).toBe(false);
  });

  it('leaves nothing behind when the pass is cancelled', async () => {
    const ffmpeg = fakePassFfmpeg({ hold: true });
    const store = createAssetAudioStore({ parent });
    const abort = new AbortController();
    const pending = store.acquire(asset, ffmpeg.ctx, abort.signal);
    setTimeout(() => abort.abort(), 20);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('media.cancelled');
    expect(await readdir(store.root)).toEqual([]);
    expect(store.stats().entries).toBe(0);
  });

  it('removes what a dead process left and keeps a live one', async () => {
    const dead = join(parent, '999999-dead0000');
    const live = join(parent, '4242-live0000');
    for (const dir of [dead, live]) {
      await mkdir(join(dir, 'abc'), { recursive: true });
      await writeFile(join(dir, 'abc', 'speech.wav'), 'x');
    }
    const store = createAssetAudioStore({ parent, isAlive: (pid) => pid === 4242 });
    await store.acquire(asset, fakePassFfmpeg().ctx);
    expect(await exists(dead)).toBe(false);
    expect(await exists(live)).toBe(true);
  });

  it('removes an idle kept pass after the idle limit, and the oldest over the byte budget', async () => {
    let clock = 0;
    const ffmpeg = fakePassFfmpeg({ frames: 16_000 });
    const store = createAssetAudioStore({ parent, now: () => clock, idleMs: 1000, maxIdleBytes: 40_000 });
    const keep = async (hash: string) => {
      const lease = await store.acquire({ ...asset, contentHash: hash }, ffmpeg.ctx);
      if (!lease.ok) throw new Error(lease.error.code);
      await lease.value.release({ keep: true });
      return lease.value.dir;
    };
    const first = await keep('1'.repeat(64));
    clock = 10;
    const second = await keep('2'.repeat(64));
    clock = 20;
    // Three idle passes of 32 000 bytes are over the 40 000-byte budget: the two oldest go.
    const third = await keep('3'.repeat(64));
    expect([await exists(first), await exists(second), await exists(third)]).toEqual([false, false, true]);
    clock = 2000;
    await store.sweep();
    expect(await exists(third)).toBe(false);
  });

  it('removes everything it wrote on close', async () => {
    const store = createAssetAudioStore({ parent });
    const lease = await store.acquire(asset, fakePassFfmpeg().ctx);
    if (!lease.ok) throw new Error(lease.error.code);
    await lease.value.release({ keep: true });
    await store.close();
    expect(await exists(store.root)).toBe(false);
  });

  it('says there is no audio for a plan without a sound stream, and keeps no folder', async () => {
    const store = createAssetAudioStore({ parent });
    const { audio: _audio, ...silentPlan } = audioPlan(1000);
    const result = await store.acquire({ ...asset, plan: silentPlan }, fakePassFfmpeg().ctx);
    expect(result.ok ? 'ok' : result.error.code).toBe('audio.no_audio');
    expect(await readdir(store.root)).toEqual([]);
  });
});
