// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `vision.readShotText` with no OCR engine in the process (IX2-F12, PO decision F3): the shots keep the text an
 * earlier engine read, so their on-screen-text vectors stay, untouched; only the vectors of shots that are gone go.
 * A job built before IX2-F12 doesn't say which shots hold text, and drops the asset's text vectors as it did.
 */
import { newId, RationalTime, TimeRange, type JobContext, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { EMBEDDING_SPACE } from '../../src/embed/space';
import type { VisionJobDeps } from '../../src/jobs/deps';
import { ocrJobRegistrations } from '../../src/jobs/ocr-handlers';
import type { ReadShotTextInput } from '../../src/jobs/ocr-kinds';
import { memoryVectorIndex } from '../helpers/vector-index';

const RATE = { num: 30, den: 1 };
const range = (start: number) => TimeRange.of(RationalTime.of(start, RATE), RationalTime.of(30, RATE));
const context: JobContext = {
  jobId: newId<'Job'>(),
  projectId: null,
  attempt: 1,
  signal: new AbortController().signal,
  progress: () => {},
};

function library() {
  const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 4);
  const assetId = newId<'Asset'>();
  const sourceId = newId<'Source'>();
  const kept: ShotId = newId<'Shot'>();
  const plain: ShotId = newId<'Shot'>();
  const gone: ShotId = newId<'Shot'>();
  const vector = (n: number) => Float32Array.of(n, 1, 0, 0);
  const metadata = { assetId, sourceId, kind: 'ocr' };
  index.upsert([
    { id: `ocr:${kept}:0`, vector: vector(1), metadata },
    { id: `ocr:${kept}:1`, vector: vector(2), metadata },
    { id: `ocr:${gone}:0`, vector: vector(3), metadata },
    { id: `frame:${gone}:0`, vector: vector(4), metadata: { ...metadata, kind: 'frame' } },
    { id: `ocr:other:0`, vector: vector(5), metadata: { ...metadata, assetId: newId<'Asset'>() } },
  ]);
  const deps: VisionJobDeps = {
    media: { binaries: { ffmpeg: '/no/ffmpeg', ffprobe: '/no/ffprobe', source: 'env' } },
    tier: 'recommended',
    index,
    tempDir: '/no/temp',
  };
  const run = async (input: ReadShotTextInput) => {
    const [registration] = ocrJobRegistrations(deps);
    if (!registration) throw new Error('no vision.readShotText handler');
    return registration.handler(input, context);
  };
  const vectorsOf = (ids: readonly string[]) => {
    const found = index.get(ids);
    if (!found.ok) throw new Error(found.error.code);
    return [...found.value.entries()];
  };
  // The current shots: `kept` holds two text tracks, `plain` none; `gone` was re-detected away.
  const input: ReadShotTextInput = {
    assetId,
    sourceId,
    path: '/clips/a.mov',
    shots: [
      { shotId: kept, range: range(0), bestFrame: 3, textTracks: 2 },
      { shotId: plain, range: range(30), bestFrame: 3 },
    ],
    languages: ['en'],
  };
  return { index, input, run, vectorsOf, kept, gone, sourceId, assetId };
}

describe('vision.readShotText with no OCR engine (IX2-F12)', () => {
  it('keeps the vectors of shots that keep their text and removes those of shots that are gone', async () => {
    const { index, input, run, vectorsOf, kept, gone, sourceId, assetId } = library();
    const before = vectorsOf([`ocr:${kept}:0`, `ocr:${kept}:1`]);
    expect(before).toHaveLength(2);
    const ran = await run(input);
    expect(ran).toMatchObject({ ok: true, value: { shots: [] } });
    expect([...index.rows.keys()].sort()).toEqual(
      [`frame:${gone}:0`, `ocr:${kept}:0`, `ocr:${kept}:1`, 'ocr:other:0'].sort(),
    );
    expect(vectorsOf([`ocr:${kept}:0`, `ocr:${kept}:1`])).toEqual(before);
    expect(index.rows.get(`ocr:${kept}:1`)).toMatchObject({ assetId, sourceId, kind: 'ocr' });
  });

  it('drops the asset’s text vectors for a job from before it said which shots hold text', async () => {
    const { index, input, run, kept } = library();
    const { sourceId: _sourceId, ...older } = input;
    expect((await run({ ...older, shots: older.shots.map(({ textTracks: _t, ...shot }) => shot) })).ok).toBe(
      true,
    );
    expect(index.rows.has(`ocr:${kept}:0`)).toBe(false);
    expect([...index.rows.keys()].filter((id) => id.startsWith('ocr:'))).toEqual(['ocr:other:0']);
  });
});
