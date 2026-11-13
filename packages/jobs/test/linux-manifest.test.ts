// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-CMP: the shipped manifest with the linux-x64 builds (tools/components/manifest.linux.provisional.json, composed
 * by compose-provisional.mjs; hosted since 2026-10-28) is a valid manifest, and the download of everything a machine needs takes from it what
 * the machine runs: on the RTX 4090 host the CUDA builds and the CUDA runtime; with the GPU hidden only the CPU
 * builds; on an Ubuntu 22.04 host, Vulkan for llama.cpp (its CUDA build needs glibc 2.38); on a Mac what it had.
 * LNX1-TRM: the CUDA runtime states NVIDIA's terms (the plan's NVIDIA_ACCEPTANCE); until they are accepted the host
 * gets the next GPU build of each group instead.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  machineFit,
  neededComponents,
  parseManifest,
  planSet,
  tierPicks,
  type ComponentEntry,
  type ComponentManifest,
  type MachineDescription,
} from '@taalcut/jobs';

const componentsDir = new URL('../../../tools/components/', import.meta.url);
const compose = new URL('compose-provisional.mjs', componentsDir);
const LINUX_FILE = 'manifest.linux.provisional.json';
const linuxPlan = new URL('../../../tools/components/hosting/plan/linux.mjs', import.meta.url);
const { NVIDIA_ACCEPTANCE, LINUX } = (await import(pathToFileURL(linuxPlan.pathname).href)) as {
  NVIDIA_ACCEPTANCE: unknown;
  LINUX: Record<string, { acceptance?: unknown }>;
};
const { compose: composeManifest, SOURCES } = (await import(pathToFileURL(compose.pathname).href)) as {
  compose(read?: (name: string) => unknown): unknown;
  SOURCES: readonly string[];
};

/** The shipped manifest, or the same sources without the Linux file: what a Mac had before it was hosted. */
function manifestWith(linux: boolean): ComponentManifest {
  const read = (name: string): unknown =>
    !linux && name === LINUX_FILE
      ? { components: [] }
      : JSON.parse(readFileSync(new URL(name, componentsDir), 'utf8'));
  const parsed = parseManifest(composeManifest(read));
  if (!parsed.ok) throw new Error(parsed.error.detail ?? parsed.error.code);
  return parsed.value;
}

const RTX_4090_HOST: MachineDescription = {
  platform: 'linux',
  arch: 'x64',
  osVersion: '24.04',
  glibcVersion: '2.39',
  gpus: [
    {
      vendor: 'nvidia',
      apis: ['cuda', 'vulkan'],
      driverVersion: '615.71.09',
      computeCapability: '8.9',
      vramBytes: 24 * 1024 ** 3,
    },
  ],
};

function needed(manifest: ComponentManifest, machine: MachineDescription, platform: string): string[] {
  const fits = (c: ComponentEntry) => machineFit(c, machine).fits;
  const picks = tierPicks(manifest, 'high', platform, fits).map((c) => c.id);
  const order = neededComponents(manifest, picks, platform);
  if (!order.ok) throw new Error(order.error.code);
  return order.value.map((c) => c.id).sort();
}

const LINUX_ALWAYS = [
  // Any platform's model; the desktop fetches it only for a person who speaks an Indian language (LIB1-LANG).
  'anuvani-lid',
  'beat-this',
  'embeddinggemma-2',
  'hyperframes-headless-shell',
  'local-llm-qwen3-5-4b',
  'local-llm-qwen3-5-4b-mmproj',
  'onnxruntime',
  'ppocr-v5-devanagari',
  'ppocr-v5-latin',
  'sfx-pack',
  'silero-vad',
  'subjects-onnx',
  'transnetv2',
  'whisper-cpp',
  'whisper-medium-q5-0',
  'whisper-tiny',
];

describe('the linux-x64 builds', () => {
  it('are in the shipped manifest: six components of their own, and linux-x64 artifacts on the rest', () => {
    expect(SOURCES).toContain(LINUX_FILE);
    const shipped = manifestWith(true);
    const macOnly = manifestWith(false);
    expect(shipped.components.length).toBe(macOnly.components.length + 6);
    expect(macOnly.components.some((c) => c.artifacts.some((a) => a.platform === 'linux-x64'))).toBe(false);
    expect(shipped.components.filter((c) => c.artifacts.some((a) => a.platform === 'linux-x64'))).not.toEqual(
      [],
    );
  });

  it('give the RTX 4090 host the CUDA builds and the CUDA runtime', () => {
    expect(needed(manifestWith(true), RTX_4090_HOST, 'linux-x64')).toEqual(
      [
        ...LINUX_ALWAYS,
        'cuda-runtime-13',
        'local-llm-runtime-cuda',
        'onnxruntime-cuda',
        'whisper-server-cuda',
      ].sort(),
    );
  });

  it('give the host with its GPU hidden only the CPU builds', () => {
    const hidden = { ...RTX_4090_HOST, gpus: [] };
    const ids = needed(manifestWith(true), hidden, 'linux-x64');
    expect(ids.filter((id) => /cuda|vulkan/.test(id))).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(['local-llm-runtime', 'whisper-server', 'onnxruntime']));
  });

  it('give an Ubuntu 22.04 NVIDIA host llama.cpp on Vulkan: its CUDA build needs glibc 2.38', () => {
    const jammy = { ...RTX_4090_HOST, osVersion: '22.04', glibcVersion: '2.35' };
    const ids = needed(manifestWith(true), jammy, 'linux-x64');
    expect(ids).toContain('local-llm-runtime-vulkan');
    expect(ids).toEqual(
      expect.arrayContaining(['onnxruntime-cuda', 'whisper-server-cuda', 'cuda-runtime-13']),
    );
    expect(ids).not.toContain('local-llm-runtime-cuda');
  });

  it("change nothing a Mac needs but the Core ML model's macOS 15 rule", () => {
    const mac = (osVersion: string): MachineDescription => ({
      platform: 'darwin',
      arch: 'arm64',
      osVersion,
      gpus: [{ vendor: 'apple', apis: ['metal'] }],
    });
    const before = needed(manifestWith(false), mac('15.1'), 'darwin-arm64');
    expect(needed(manifestWith(true), mac('15.1'), 'darwin-arm64')).toEqual(before);
    expect(needed(manifestWith(true), mac('14.7'), 'darwin-arm64')).toEqual(
      before.filter((id) => id !== 'embeddinggemma-2-coreml'),
    );
  });
});

describe("the CUDA runtime under NVIDIA's terms", () => {
  const planned = (unaccepted: readonly string[]) => {
    const plan = planSet({
      manifest: manifestWith(true),
      platform: 'linux-x64',
      fit: { tier: 'high', machine: RTX_4090_HOST },
      unaccepted: new Set(unaccepted),
    });
    if (!plan.ok) throw new Error(plan.error.code);
    return plan.value;
  };

  it('states the terms the plan names, with the official documents', () => {
    const cuda = manifestWith(true).components.find((c) => c.id === 'cuda-runtime-13');
    expect(cuda?.licence.acceptance).toEqual(NVIDIA_ACCEPTANCE);
    expect(LINUX['cuda-runtime-13']?.acceptance).toEqual(NVIDIA_ACCEPTANCE);
    expect(cuda?.licence.acceptance?.documents.map((d) => d.url)).toEqual([
      'https://docs.nvidia.com/cuda/eula/index.html',
      'https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html',
    ]);
    const others = manifestWith(true).components.filter((c) => c.licence.acceptance && c.id !== cuda?.id);
    expect(others).toEqual([]);
  });

  it('give the host the next GPU build of each group until they are accepted', () => {
    const before = planned(['cuda-runtime-13']);
    const ids = before.needed.map((c) => c.id).sort();
    expect(ids).toEqual([...LINUX_ALWAYS, 'local-llm-runtime-vulkan', 'whisper-server'].sort());
    expect(before.held.map((h) => [h.component.id, [...h.unlocks].sort()])).toEqual([
      ['cuda-runtime-13', ['local-llm-runtime-cuda', 'onnxruntime-cuda', 'whisper-server-cuda']],
    ]);
    const after = planned([]);
    expect(after.held).toEqual([]);
    expect(after.needed.map((c) => c.id).sort()).toEqual(
      needed(manifestWith(true), RTX_4090_HOST, 'linux-x64'),
    );
  });
});
