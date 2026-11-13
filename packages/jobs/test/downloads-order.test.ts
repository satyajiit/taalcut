// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: what this Mac needs and the order the download takes it in. What a caller wants first goes to
 * the front with its dependencies; the largest starts next, in a lane of its own; the rest go smallest first.
 */
import { describe, expect, it } from 'vitest';
import { downloadOrder, neededComponents } from '@taalcut/jobs';
import { manifestOf } from './helpers/fixtures';

const sha = 'a'.repeat(64);
const manifest = manifestOf(
  { id: 'onnxruntime', urls: ['https://x.test/o'], size: 9, sha256: sha, tiers: ['minimum'] },
  { id: 'gemma', urls: ['https://x.test/g'], size: 237, sha256: sha, dependencies: ['onnxruntime'] },
  { id: 'gemma-coreml', urls: ['https://x.test/c'], size: 2, sha256: sha, dependencies: ['gemma'] },
  { id: 'whisper-cpp', urls: ['https://x.test/w'], size: 8, sha256: sha },
  { id: 'whisper-tiny', urls: ['https://x.test/t'], size: 78, sha256: sha, dependencies: ['whisper-cpp'] },
  { id: 'qwen', urls: ['https://x.test/q'], size: 2600, sha256: sha },
  { id: 'intel-only', urls: ['https://x.test/i'], size: 5, sha256: sha, platform: 'darwin-x64' },
);
const size = (id: string) => manifest.components.find((c) => c.id === id)?.artifacts[0]?.size ?? 0;

describe('what this Mac needs', () => {
  it('adds what the picks depend on, dependencies first; a pick with no build for this Mac is not one', () => {
    const needed = neededComponents(
      manifest,
      ['gemma-coreml', 'whisper-tiny', 'qwen', 'intel-only'],
      'darwin-arm64',
    );
    expect(needed.ok && needed.value.map((c) => c.id)).toEqual([
      'onnxruntime',
      'gemma',
      'gemma-coreml',
      'whisper-cpp',
      'whisper-tiny',
      'qwen',
    ]);
  });

  it('refuses a pick the manifest doesn’t know', () => {
    const needed = neededComponents(manifest, ['nope'], 'darwin-arm64');
    expect(!needed.ok && needed.error).toMatchObject({ code: 'jobs.component_unknown' });
  });
});

describe('the download order', () => {
  const needed = () => {
    const result = neededComponents(manifest, ['gemma-coreml', 'whisper-tiny', 'qwen'], 'darwin-arm64');
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };

  it('starts the largest at once, then the rest smallest first', () => {
    expect(downloadOrder(needed(), size)).toEqual([
      'qwen',
      'gemma-coreml',
      'whisper-cpp',
      'onnxruntime',
      'whisper-tiny',
      'gemma',
    ]);
  });

  it('puts what is asked first at the front, after what it needs', () => {
    expect(downloadOrder(needed(), size, ['gemma'])).toEqual([
      'onnxruntime',
      'gemma',
      'qwen',
      'gemma-coreml',
      'whisper-cpp',
      'whisper-tiny',
    ]);
  });

  it('ignores an id that isn’t needed, and keeps the manifest order between equal sizes', () => {
    const flat = (id: string) => (id === 'qwen' ? 10 : 1);
    expect(downloadOrder(needed(), flat, ['intel-only'])).toEqual([
      'qwen',
      'onnxruntime',
      'gemma',
      'gemma-coreml',
      'whisper-cpp',
      'whisper-tiny',
    ]);
  });
});
