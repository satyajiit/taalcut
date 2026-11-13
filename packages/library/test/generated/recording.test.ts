// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { RationalTime, unwrap, type RecordedFile } from '@taalcut/core';
import { image, row, setup } from './fixture';

const take: RecordedFile = {
  bytes: new TextEncoder().encode('saved mono take'),
  fileName: 'narration.wav',
  mediaType: 'audio/wav',
  provenance: { kind: 'captured' },
  projectId: null,
  duration: RationalTime.of(48_000, { num: 48_000, den: 1 }),
};
it('retains human recordings, including bytes previously kept by the generated sink', async () => {
  const env = setup();
  const generated = unwrap(
    await env.sink.put({ ...image('saved mono take'), fileName: 'line.wav', mediaType: 'audio/wav' }),
  );
  expect(
    row(env.db, 'SELECT asset_id FROM generated_assets WHERE asset_id = ?', generated.assetId),
  ).toBeDefined();
  const saved = unwrap(await env.sink.putRecording!(take));
  expect(saved.assetId).toBe(generated.assetId);
  expect(
    row(env.db, 'SELECT asset_id FROM generated_assets WHERE asset_id = ?', saved.assetId),
  ).toBeUndefined();
  expect(row(env.db, 'SELECT duration_value FROM assets WHERE id = ?', saved.assetId)).toEqual({
    duration_value: 48_000,
  });
  expect(
    (await env.sink.putRecording!({ ...take, duration: RationalTime.of(0, take.duration.rate) })).ok,
  ).toBe(false);
});
it('a fresh recording stays durable without being placed on a timeline', async () => {
  const env = setup(),
    saved = unwrap(await env.sink.putRecording!(take));
  expect(
    row(env.db, 'SELECT asset_id FROM generated_assets WHERE asset_id = ?', saved.assetId),
  ).toBeUndefined();
  expect(row(env.db, 'SELECT provenance FROM assets WHERE id = ?', saved.assetId)).toEqual({
    provenance: JSON.stringify({ kind: 'captured' }),
  });
});
