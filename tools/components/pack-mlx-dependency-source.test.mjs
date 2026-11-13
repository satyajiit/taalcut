// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import assert from 'node:assert/strict';
import test from 'node:test';
import { packagePins } from './pack-mlx-dependency-source.mjs';
const pin = {
  identity: 'mlx-swift',
  location: 'https://github.com/ml-explore/mlx-swift',
  state: { revision: 'a'.repeat(40), version: '1.0.0' },
};
test('dependency source inventory accepts exact pinned GitHub revisions', () => {
  assert.deepEqual(packagePins({ pins: [pin] }), [
    { identity: pin.identity, url: pin.location, revision: pin.state.revision, version: '1.0.0' },
  ]);
});
test('unsafe paths, duplicate pins and floating revisions fail closed', () => {
  for (const bad of [
    { ...pin, identity: '../escape' },
    { ...pin, location: 'file:///secret' },
    { ...pin, state: { revision: 'main' } },
  ])
    assert.throws(() => packagePins({ pins: [bad] }));
  assert.throws(() => packagePins({ pins: [pin, pin] }));
});
