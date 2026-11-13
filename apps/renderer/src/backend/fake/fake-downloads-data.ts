// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (product names, ids, versions), never UI copy */

/**
 * What a Recommended-tier Mac needs (UX2-DOWNLOADER), as the components manifest lists it: every component the tier
 * names, with what they depend on, each with its job, its real size (unpacked too, for an archive) and the modules
 * that use it. The fake download set (fake-downloads.ts) fetches these.
 */
import type { Component, ComponentJob, ModelModuleId } from '@taalcut/core';

const MB = 1000 ** 2;

export interface FakePart {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly sizeBytes: number;
  /** An archive's size once unpacked: it and the archive are on disk at once while it installs. */
  readonly unpackedBytes?: number;
  readonly job: ComponentJob;
  readonly usedBy: readonly ModelModuleId[];
  /** Installed before it can install (the manifest's `dependencies`). */
  readonly needs?: readonly string[];
}

export const FAKE_PARTS: readonly FakePart[] = [
  {
    id: 'whisper-cpp',
    name: 'whisper.cpp',
    version: '1.8.2',
    licence: 'MIT',
    sizeBytes: 7.98 * MB,
    job: 'speech',
    usedBy: ['speech'],
  },
  {
    id: 'whisper-server',
    name: 'whisper.cpp server',
    version: '1.8.2',
    licence: 'MIT',
    sizeBytes: 8.38 * MB,
    job: 'speech',
    usedBy: ['speech'],
  },
  {
    id: 'whisper-tiny',
    name: 'Whisper tiny',
    version: '5359861c',
    licence: 'MIT',
    sizeBytes: 77.69 * MB,
    job: 'speech',
    usedBy: ['speech'],
    needs: ['whisper-cpp'],
  },
  {
    id: 'whisper-medium-q5-0',
    name: 'Whisper medium Q5_0',
    version: '5359861c',
    licence: 'MIT',
    sizeBytes: 539.21 * MB,
    job: 'speech',
    usedBy: ['speech'],
    needs: ['whisper-cpp'],
  },
  {
    id: 'silero-vad',
    name: 'Silero VAD',
    version: '5.1.2',
    licence: 'MIT',
    sizeBytes: 2.33 * MB,
    job: 'speech',
    usedBy: ['speech'],
    needs: ['onnxruntime'],
  },
  {
    id: 'onnxruntime',
    name: 'ONNX Runtime',
    version: '1.23.2',
    licence: 'MIT',
    sizeBytes: 9.16 * MB,
    unpackedBytes: 44.63 * MB,
    job: 'search',
    usedBy: ['embeddings'],
  },
  {
    id: 'embeddinggemma-2',
    name: 'EmbeddingGemma 2',
    version: '2.0.0',
    licence: 'Gemma',
    sizeBytes: 236.9 * MB,
    unpackedBytes: 304.47 * MB,
    job: 'search',
    usedBy: ['embeddings'],
    needs: ['onnxruntime'],
  },
  {
    id: 'embeddinggemma-2-coreml',
    name: 'EmbeddingGemma 2 (Core ML)',
    version: '2.0.0',
    licence: 'Gemma',
    sizeBytes: 1.93 * MB,
    unpackedBytes: 16.05 * MB,
    job: 'search',
    usedBy: ['embeddings'],
    needs: ['embeddinggemma-2'],
  },
  {
    id: 'ppocr-v5-devanagari',
    name: 'PP-OCRv5 Devanagari',
    version: '5.0.0',
    licence: 'Apache-2.0',
    sizeBytes: 11.79 * MB,
    unpackedBytes: 12.75 * MB,
    job: 'text',
    usedBy: ['vision'],
    needs: ['onnxruntime'],
  },
  {
    id: 'transnetv2',
    name: 'TransNetV2',
    version: '1.0.0',
    licence: 'MIT',
    sizeBytes: 31.25 * MB,
    job: 'shots',
    usedBy: ['vision'],
    needs: ['onnxruntime'],
  },
  {
    id: 'transnetv2-coreml',
    name: 'TransNetV2 (Core ML)',
    version: '1.0.0',
    licence: 'MIT',
    sizeBytes: 27.97 * MB,
    unpackedBytes: 30.61 * MB,
    job: 'shots',
    usedBy: ['vision'],
  },
  {
    id: 'beat-this',
    name: 'Beat This!',
    version: '1.0.0',
    licence: 'MIT',
    sizeBytes: 122.64 * MB,
    unpackedBytes: 190.91 * MB,
    job: 'beats',
    usedBy: [],
    needs: ['onnxruntime'],
  },
  {
    id: 'local-llm-runtime',
    name: 'llama.cpp server',
    version: 'b11571',
    licence: 'MIT',
    sizeBytes: 12.11 * MB,
    unpackedBytes: 32.61 * MB,
    job: 'writing',
    usedBy: ['agent', 'vision'],
  },
  {
    id: 'local-llm-qwen3-5-4b',
    name: 'Qwen3.5 4B',
    version: 'q4_k_m-a9d0a3e1',
    licence: 'Apache-2.0',
    sizeBytes: 2648.59 * MB,
    job: 'writing',
    usedBy: ['agent', 'vision'],
  },
  {
    id: 'local-llm-qwen3-5-4b-mmproj',
    name: 'Qwen3.5 4B vision projector',
    version: 'bf16-e56a899b',
    licence: 'Apache-2.0',
    sizeBytes: 675.57 * MB,
    job: 'writing',
    usedBy: ['vision'],
  },
  {
    id: 'hyperframes-headless-shell',
    name: 'Chrome headless shell',
    version: '142.0.7444.0',
    licence: 'BSD-3-Clause',
    sizeBytes: 69.69 * MB,
    unpackedBytes: 201.02 * MB,
    job: 'titles',
    usedBy: [],
  },
  {
    id: 'sfx-pack',
    name: 'Taalcut sound pack',
    version: '1.0.0',
    licence: 'CC0-1.0',
    sizeBytes: 1.81 * MB,
    unpackedBytes: 2.14 * MB,
    job: 'sounds',
    usedBy: [],
  },
];

/** Everything a part can't run without, directly or through another (the jobs process's `needs`). */
function needsOf(part: FakePart): string[] {
  const out: string[] = [];
  const visit = (each: FakePart) => {
    for (const id of each.needs ?? []) {
      const need = FAKE_PARTS.find((candidate) => candidate.id === id);
      if (!need || out.includes(id)) continue;
      out.push(id);
      visit(need);
    }
  };
  visit(part);
  return out;
}

/** A part as `system.components` and `system.downloads` carry it, in a state. */
export function partComponent(part: FakePart, status: Component['status']): Component {
  const needs = needsOf(part);
  return {
    id: part.id,
    name: part.name,
    version: part.version,
    licence: part.licence,
    sizeBytes: part.sizeBytes,
    status,
    // Installed, its verified licence notice is on this Mac (round 3).
    ...(status === 'installed' ? { notice: true } : {}),
    usedBy: [...part.usedBy],
    job: part.job,
    needed: true,
    ...(needs.length > 0 ? { needs } : {}),
  };
}

/** The download order the jobs process uses: the largest at once in a lane of its own, then the rest smallest first. */
export function fakeOrder(parts: readonly FakePart[], first: readonly string[] = []): FakePart[] {
  const largest = [...parts].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
  const rest = parts.filter((part) => part !== largest).sort((a, b) => a.sizeBytes - b.sizeBytes);
  const ordered = largest ? [largest, ...rest] : rest;
  const front = new Set<string>();
  const add = (id: string) => {
    const part = parts.find((each) => each.id === id);
    if (!part || front.has(id)) return;
    for (const need of part.needs ?? []) add(need);
    front.add(id);
  };
  for (const id of first) add(id);
  return [
    ...[...front].flatMap((id) => parts.filter((part) => part.id === id)),
    ...ordered.filter((part) => !front.has(part.id)),
  ];
}
