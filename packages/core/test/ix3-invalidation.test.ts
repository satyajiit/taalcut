// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Round IX3's dependent invalidation (IX3-I2): what a stage reads and stores, and a skip that clears vectors. */
import { describe, expect, it } from 'vitest';
import { defineIndexStage, ok, type IndexStageDefinition, type IndexStageSkip } from '../src/index';

const base: IndexStageDefinition = {
  stage: 'vision.embedText',
  version: 1,
  needs: ['audio.transcript'],
  appliesTo: ['video'],
  priority: 'normal',
  job: () => ({ skip: 'indexing.skip.silent' }),
  result: () => ok({}),
};

describe('defineIndexStage: reads and stores (IX3-I2)', () => {
  it('keeps the stages a definition reads and what it stores', () => {
    const stores = (view: { transcript: unknown }) => view.transcript;
    const stage = defineIndexStage({ ...base, reads: ['audio.transcript'], stores });
    expect(stage.reads).toEqual(['audio.transcript']);
    expect(stage.stores).toBe(stores);
    expect(defineIndexStage(base).reads).toBeUndefined();
  });

  it('throws when a definition reads itself or a stage that is not a stage name', () => {
    expect(() => defineIndexStage({ ...base, reads: ['vision.embedText'] })).toThrow(/reads an invalid/);
    expect(() => defineIndexStage({ ...base, reads: ['Audio.Transcript'] })).toThrow(/reads an invalid/);
    expect(() => defineIndexStage({ ...base, reads: [''] })).toThrow(/reads an invalid/);
  });

  it('keeps optional reads, and throws on a bad one or one that is also a read or need (LRN1-CTX)', () => {
    const stage = defineIndexStage({ ...base, needs: [], optionalReads: ['audio.transcript'] });
    expect(stage.optionalReads).toEqual(['audio.transcript']);
    expect(() => defineIndexStage({ ...base, optionalReads: ['vision.embedText'] })).toThrow(
      /reads an invalid/,
    );
    expect(() => defineIndexStage({ ...base, optionalReads: ['Audio.Transcript'] })).toThrow(
      /reads an invalid/,
    );
    expect(() => defineIndexStage({ ...base, optionalReads: ['audio.transcript'] })).toThrow(
      /'audio.transcript' as an optional read and as a read or need/,
    );
    expect(() =>
      defineIndexStage({
        ...base,
        needs: [],
        reads: ['audio.transcript'],
        optionalReads: ['audio.transcript'],
      }),
    ).toThrow(/as an optional read/);
  });

  it('lets a skip name the vector kinds that go with it', () => {
    const skip: IndexStageSkip = { skip: 'indexing.skip.silent', clears: ['transcript'] };
    const stage = defineIndexStage({ ...base, job: () => skip });
    expect(stage.job({} as never)).toEqual({ skip: 'indexing.skip.silent', clears: ['transcript'] });
  });
});
