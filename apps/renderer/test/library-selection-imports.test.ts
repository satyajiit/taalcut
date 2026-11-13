// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX4 lib: picking clips (selection.ts) and what the Library's import line says (import-summary.ts).
import type { AssetId, ImportStatus, IndexingStatus, SourceId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { finishedSince, summariseImports } from '../src/features/library/import-summary';
import { NOTHING_PICKED, pickMany, pickRange, toggleClip } from '../src/features/library/selection';

const id = (n: number) => `ast_${n}` as AssetId;
const items = Array.from({ length: 10 }, (_, n) => ({ id: id(n) }));

describe('picking clips', () => {
  it('toggles one clip and makes it the anchor', () => {
    const one = toggleClip(NOTHING_PICKED, id(2), 2);
    expect([...one.ids]).toEqual([id(2)]);
    expect(one.anchor).toBe(2);
    const none = toggleClip(one, id(2), 2);
    expect(none.ids.size).toBe(0);
  });

  it('picks a range from the anchor either way, and keeps the anchor', () => {
    const start = toggleClip(NOTHING_PICKED, id(4), 4);
    const down = pickRange(start, items, 7);
    expect([...down.ids].sort()).toEqual([id(4), id(5), id(6), id(7)]);
    expect(down.anchor).toBe(4);
    const up = pickRange(down, items, 1);
    expect(up.ids.has(id(1))).toBe(true);
    expect(up.ids.size).toBe(7);
  });

  it('skips clips not loaded yet, and with no anchor picks the clip alone', () => {
    const sparse = [{ id: id(0) }, undefined, { id: id(2) }] as unknown as { id: AssetId }[];
    expect(pickRange(toggleClip(NOTHING_PICKED, id(0), 0), sparse, 2).ids.size).toBe(2);
    const alone = pickRange(NOTHING_PICKED, items, 3);
    expect([...alone.ids]).toEqual([id(3)]);
    expect(alone.anchor).toBe(3);
  });

  it('picks or lets go of a whole day', () => {
    const day = [id(1), id(2), id(3)];
    const on = pickMany(NOTHING_PICKED, day, true);
    expect(on.ids.size).toBe(3);
    expect(pickMany(on, [id(2)], false).ids.has(id(2))).toBe(false);
  });
});

const source = (n: number, state: ImportStatus['state'], counts: Partial<ImportStatus['counts']> = {}) =>
  ({
    sourceId: `src_${n}` as SourceId,
    state,
    counts: { assets: 10, done: 4, active: 2, waiting: 4, failed: 0, ...counts },
    stages: [],
    etaMs: null,
    jobIds: [],
    updatedAt: 1,
  }) satisfies ImportStatus;

const status = (sources: ImportStatus[], over: Partial<IndexingStatus> = {}): IndexingStatus => ({
  paused: false,
  overall: { assets: 100, done: 100, active: 0, waiting: 0, failed: 0 },
  sources,
  etaMs: null,
  updatedAt: 1,
  ...over,
});

describe('the import line', () => {
  it('says nothing with no import and nothing analysed', () => {
    expect(summariseImports(null).kind).toBe('none');
    expect(summariseImports(status([source(1, 'done')])).kind).toBe('none');
  });

  it('counts clips analysed after an import', () => {
    const after = summariseImports(
      status([], { overall: { assets: 10, done: 7, active: 1, waiting: 2, failed: 0 } }),
    );
    expect(after).toMatchObject({ kind: 'analysing', analysing: 3 });
  });

  it('adds several imports up into one line', () => {
    const both = summariseImports(status([source(1, 'indexing'), source(2, 'receiving', { failed: 2 })]));
    expect(both.kind).toBe('running');
    expect(both.combined?.counts).toMatchObject({ assets: 20, done: 8, failed: 2 });
    expect(both.failed).toBe(2);
    expect(both.sources).toHaveLength(2);
  });

  it('is paused when indexing is, and needs a look when an import ended with failures', () => {
    expect(summariseImports(status([source(1, 'indexing')], { paused: true })).kind).toBe('paused');
    const ended = source(1, 'failed', { done: 8, active: 0, waiting: 0, failed: 2 });
    expect(summariseImports(status([ended])).kind).toBe('attention');
  });

  it('says an import stopped when its scan failed before any clip came in', () => {
    const stopped = source(1, 'failed', { done: 0, active: 0, waiting: 0, failed: 0 });
    expect(summariseImports(status([stopped])).kind).toBe('stopped');
  });

  it('names the imports seen running that have finished since', () => {
    const seen = new Set(['src_1']);
    expect(
      finishedSince(seen, status([source(1, 'done'), source(2, 'done')])).map((s) => s.sourceId),
    ).toEqual(['src_1']);
  });
});
