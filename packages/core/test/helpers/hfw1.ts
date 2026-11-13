// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** HFW1's fixtures: a made-up composition (a message bubble) and its files. No real design ships from here. */
import { newId } from '@taalcut/core';
import { T0 } from './documents';

export const sha = (c: string) => c.repeat(64);
export const ntsc = { num: 30000, den: 1001 };
export const FILES = [
  { path: 'bubble/index.html', sha256: sha('a'), bytes: 1200 },
  { path: 'bubble/style.css', sha256: sha('b'), bytes: 400 },
];
export const COMPOSITION = {
  id: newId<'GraphicComposition'>(),
  version: 1,
  hash: sha('c'),
  name: 'Message bubble',
  entry: 'bubble/index.html',
  files: FILES,
  variables: [
    { type: 'text', name: 'message', maxLength: 120, sample: 'Are we there yet?' },
    { type: 'colour', name: 'fill', default: '#1f8bff' },
  ],
  durationSeconds: 3,
  provenance: { model: { id: 'cloud-model', onDevice: false }, overlays: [], brief: null, createdAt: T0 },
  gate: {
    version: 'hfw1-gate/1',
    passed: true,
    checkedAt: T0,
    hfLint: { errors: 0, warnings: 1 },
    checks: [
      { id: 'hfLint', status: 'pass' },
      { id: 'lowering', status: 'pass', detail: 'Lowered 4 tweens' },
    ],
    loweredTweens: 4,
  },
} as const;
