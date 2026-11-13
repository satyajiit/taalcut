// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSfxPack } from '../../src/sfx/pack-catalogue';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-sfx-pack-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const item = {
  id: 'whoosh-soft',
  title: 'Soft whoosh',
  category: 'whoosh',
  file: 'whoosh-soft.flac',
  durationMs: 900,
  peakMs: 507,
  loudnessLufs: -12.3,
  licence: 'CC0-1.0',
  source: 'https://github.com/taalcut/taalcut/tree/main/tools/audio-packs',
};

const write = (catalogue: unknown) =>
  writeFile(
    join(dir, 'catalogue.json'),
    typeof catalogue === 'string' ? catalogue : JSON.stringify(catalogue),
  );

const pack = (items: unknown[]) => ({ version: 1, pack: 'sfx-pack', packVersion: '1.0.0', items });

describe('the sound pack catalogue (sfx-pack)', () => {
  it('loads a valid pack and resolves each file inside the pack folder', async () => {
    await write(pack([item]));
    const loaded = await loadSfxPack(dir);
    if (!loaded.ok) throw new Error(loaded.error.code);
    const [only] = loaded.value.items;
    expect(only).toEqual(item);
    expect(only && loaded.value.pathOf(only)).toBe(join(dir, 'whoosh-soft.flac'));
  });

  it('is audio.sfx_pack_missing when absent, not JSON, empty, or holding a non-CC0 or unknown-category sound', async () => {
    const codes: string[] = [];
    const code = async () => {
      const loaded = await loadSfxPack(dir);
      codes.push(loaded.ok ? 'ok' : loaded.error.code);
    };
    await code();
    await write('{ nope');
    await code();
    await write(pack([]));
    await code();
    await write(pack([{ ...item, licence: 'CC-BY-4.0' }]));
    await code();
    await write(pack([{ ...item, category: 'boing' }]));
    await code();
    await write(pack([{ ...item, file: '../escape.flac' }]));
    await code();
    expect(codes).toEqual(Array(6).fill('audio.sfx_pack_missing'));
  });
});
