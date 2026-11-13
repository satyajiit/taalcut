// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TOOLGROUPS: library.getAsset and library.findSimilar say which files a call was about, for the call's row in
 * the chat: a file name and its length, never a folder, a description or a transcript.
 */
import { callClock, ok, unwrap, type AnyTool, type ToolContext } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { libraryToolModule } from '../../src/index';
import { describeAssetCall, describeSimilarCall } from '../../src/search/call-summaries';
import { searchFixture } from '../search/search-helpers';

function setup() {
  const s = searchFixture();
  const module = libraryToolModule({
    db: s.db,
    search: s.search,
    importStatus: async () => ok({ paused: false } as never),
    home: '/Users/me',
  });
  const tool = (name: string) => module.tools.find((t) => t.name === name)! as AnyTool;
  const ctx = { signal: new AbortController().signal, attempt: 1 } as unknown as ToolContext;
  /** Runs the tool as the executor does, and answers what its call says. */
  const said = async (name: string, raw: unknown) => {
    const t = tool(name);
    const input = t.input.parse(raw);
    const output = t.output.parse(unwrap(await t.run(input, ctx)));
    return { said: t.describeCall?.(input, output), output: output as Record<string, unknown> };
  };
  return { ...s, said };
}

describe('library.getAsset describes its call', () => {
  it('by the file’s name and length', async () => {
    const t = setup();
    const assetId = t.fixture.assets.find((id) => unwrap(t.repos.assets.get(id)).kind === 'video')!;
    const { said, output } = await t.said('library.getAsset', { assetId, include: ['shots', 'transcript'] });
    const asset = output.asset as {
      fileName: string;
      duration: { value: number; rate: { num: number; den: number } };
    };
    const seconds = (asset.duration.value * asset.duration.rate.den) / asset.duration.rate.num;
    // Exactly the name and the length: nothing from its shots' descriptions or its transcript.
    expect(said).toBe(`${asset.fileName} · ${callClock(seconds)}`);
    expect(said).toMatch(/^[\w-]+\.mov · \d+:\d{2}$/);
    expect((output.shots as unknown[]).length).toBeGreaterThan(0);
  });

  it('by its name alone when it has no length, and never by its folder', () => {
    const asset = { fileName: '/Users/me/Trip/IMG_0412.HEIC', duration: null };
    expect(describeAssetCall({ asset } as never)).toBe('IMG_0412.HEIC');
    const zero = { fileName: 'IMG_0413.MOV', duration: { value: 0, rate: { num: 30, den: 1 } } };
    expect(describeAssetCall({ asset: zero } as never)).toBe('IMG_0413.MOV');
    const film = { fileName: 'IMG_0414.MOV', duration: { value: 1439, rate: { num: 30_000, den: 1001 } } };
    expect(describeAssetCall({ asset: film } as never)).toBe('IMG_0414.MOV · 0:48');
    expect(describeAssetCall({ asset: { fileName: '', duration: null } } as never)).toBeUndefined();
  });
});

describe('library.findSimilar describes its call', () => {
  it('by the files its closest shots are in, nearest first', async () => {
    const t = setup();
    const assetId = t.fixture.assets.find((id) => unwrap(t.repos.assets.get(id)).kind === 'video')!;
    const { said, output } = await t.said('library.findSimilar', { assetId, limit: 12 });
    const names = [...new Set((output.hits as { fileName: string }[]).map((hit) => hit.fileName))];
    expect(names.length).toBeGreaterThan(2);
    expect(said).toBe(`${names[0]}, ${names[1]} +${names.length - 2}`);
  });

  it('names one or two files whole, and nothing when nothing was found', () => {
    const hits = (...names: string[]) => ({ hits: names.map((fileName) => ({ fileName })) });
    expect(describeSimilarCall(hits('A.MOV', 'A.MOV', '/x/B.MOV'))).toBe('A.MOV, B.MOV');
    expect(describeSimilarCall(hits('A.MOV'))).toBe('A.MOV');
    expect(describeSimilarCall(hits())).toBeUndefined();
  });
});
