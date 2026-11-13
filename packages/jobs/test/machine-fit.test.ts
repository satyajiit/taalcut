// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1 seam 4: a component's `requires` against the machine's description, the manifest rules for `requires` and
 * `variants`, and which member of a variant group runs here.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseVariant,
  compareVersions,
  describeChoices,
  machineFit,
  parseManifest,
  tierPicks,
  type ComponentEntry,
  type MachineDescription,
} from '@taalcut/jobs';
import { componentJson, manifestOf, type FileComponentSpec } from './helpers/fixtures';

const GiB = 1024 ** 3;
/** The LNX1 host: Ubuntu 24.04, an RTX 4090 on driver 615.71.09. */
const RTX_4090_HOST: MachineDescription = {
  platform: 'linux',
  arch: 'x64',
  osVersion: '24.04',
  gpus: [
    {
      vendor: 'nvidia',
      apis: ['cuda', 'vulkan'],
      driverVersion: '615.71.09',
      computeCapability: '8.9',
      vramBytes: 24 * GiB,
    },
  ],
};
const CPU_ONLY: MachineDescription = { platform: 'linux', arch: 'x64', osVersion: '24.04', gpus: [] };
const CUDA_13 = { gpuApi: 'cuda', minDriver: '580', minComputeCapability: '7.5' };

describe('compareVersions', () => {
  it('compares dotted numbers part by part, missing parts as 0', () => {
    expect(compareVersions('615.71.09', '580')).toBeGreaterThan(0);
    expect(compareVersions('575.57.08', '580')).toBeLessThan(0);
    expect(compareVersions('15', '15.0.0')).toBe(0);
    expect(compareVersions('14.7.2', '15')).toBeLessThan(0);
    expect(compareVersions('8.9', '7.5')).toBeGreaterThan(0);
    expect(compareVersions('12.0', '7.5')).toBeGreaterThan(0);
  });

  it('never lets a part that is not a number meet a minimum', () => {
    expect(compareVersions('580.beta', '580.0')).toBeLessThan(0);
  });
});

describe('machineFit', () => {
  it('fits a component that requires nothing, on any machine or none', () => {
    expect(machineFit({}, undefined)).toEqual({ fits: true });
    expect(machineFit({ requires: {} }, CPU_ONLY)).toEqual({ fits: true });
  });

  it('fits CUDA 13 on the RTX 4090 host and says why not elsewhere', () => {
    expect(machineFit({ requires: CUDA_13 }, RTX_4090_HOST)).toEqual({ fits: true });
    expect(machineFit({ requires: CUDA_13 }, CPU_ONLY)).toEqual({
      fits: false,
      reason: 'no GPU here offers cuda',
    });
    const oldDriver = { ...RTX_4090_HOST, gpus: [{ ...RTX_4090_HOST.gpus[0]!, driverVersion: '575.57.08' }] };
    expect(machineFit({ requires: CUDA_13 }, oldDriver)).toEqual({
      fits: false,
      reason: 'the cuda GPU falls short: the nvidia driver is 575.57.08; it needs 580 or later',
    });
  });

  it('needs every GPU requirement met by one GPU, and a known value for each', () => {
    const pascal = { vendor: 'nvidia', apis: ['cuda'], driverVersion: '590', computeCapability: '6.1' };
    const unknownCc = { vendor: 'nvidia', apis: ['cuda'], driverVersion: '590' };
    const twoGpus = { ...CPU_ONLY, gpus: [pascal, RTX_4090_HOST.gpus[0]!] };
    expect(machineFit({ requires: CUDA_13 }, twoGpus)).toEqual({ fits: true });
    expect(machineFit({ requires: CUDA_13 }, { ...CPU_ONLY, gpus: [pascal] })).toMatchObject({
      fits: false,
      reason: expect.stringContaining('compute capability 6.1; it needs 7.5'),
    });
    expect(machineFit({ requires: CUDA_13 }, { ...CPU_ONLY, gpus: [unknownCc] })).toMatchObject({
      reason: expect.stringContaining('compute capability is unknown'),
    });
    const big = { gpuApi: 'cuda', minVramBytes: 32 * GiB };
    expect(machineFit({ requires: big }, RTX_4090_HOST)).toMatchObject({ fits: false });
  });

  it('expresses the Core ML rule: darwin, macOS 15 or later', () => {
    const coreMl = { requires: { platform: 'darwin', minOsVersion: '15' } };
    const mac = (osVersion: string) => ({ platform: 'darwin', arch: 'arm64', osVersion, gpus: [] });
    expect(machineFit(coreMl, mac('15.0'))).toEqual({ fits: true });
    expect(machineFit(coreMl, mac('26.1'))).toEqual({ fits: true });
    expect(machineFit(coreMl, mac('14.7.2'))).toMatchObject({ fits: false });
    expect(machineFit(coreMl, RTX_4090_HOST)).toEqual({
      fits: false,
      reason: 'it runs on darwin; this is linux',
    });
    expect(machineFit(coreMl, undefined)).toEqual({
      fits: false,
      reason: "this machine's hardware is unknown",
    });
  });

  it('needs a new enough glibc for an upstream build made on a newer distribution', () => {
    const requires = { minGlibc: '2.38', ...CUDA_13 };
    expect(machineFit({ requires }, { ...RTX_4090_HOST, glibcVersion: '2.39' })).toEqual({ fits: true });
    expect(machineFit({ requires }, { ...RTX_4090_HOST, glibcVersion: '2.35' })).toEqual({
      fits: false,
      reason: 'it needs glibc 2.38 or later; this has 2.35',
    });
    expect(machineFit({ requires }, RTX_4090_HOST)).toMatchObject({ fits: false });
  });

  it("keeps a component off the machine when it requires something this build can't check", () => {
    expect(machineFit({ requires: { gpuApi: 'cuda', minFlops: 9 } }, RTX_4090_HOST)).toEqual({
      fits: false,
      reason: "it requires minFlops, which this build can't check",
    });
  });
});

const sha = 'b'.repeat(64);
const spec = (id: string, extra: Partial<FileComponentSpec> = {}): FileComponentSpec => ({
  id,
  urls: [`https://x.test/${id}`],
  size: 10,
  sha256: sha,
  platform: 'linux-x64',
  ...extra,
});
const parsed = (...specs: FileComponentSpec[]) =>
  parseManifest({ schemaVersion: 1, components: specs.map(componentJson) });

describe('requires and variants in the manifest', () => {
  it('accepts requires and keeps a key it does not know (which then never fits)', () => {
    const manifest = parsed(spec('ort-cuda', { requires: { ...CUDA_13, minFlops: 9 } }));
    expect(manifest.ok && manifest.value.components[0]!.requires).toMatchObject({ minFlops: 9 });
  });

  it('refuses a GPU minimum without a GPU API and an OS minimum without a platform', () => {
    expect(parsed(spec('a', { requires: { minDriver: '580' } })).ok).toBe(false);
    expect(parsed(spec('a', { requires: { minOsVersion: '15' } })).ok).toBe(false);
    expect(parsed(spec('a', { requires: { gpuApi: 'CUDA!' } })).ok).toBe(false);
  });

  it('refuses a variant that is unknown, itself, shared, nested or listed by a tier', () => {
    const base = (variants: string[]) => spec('rt', { tiers: ['minimum'], variants });
    expect(parsed(base(['rt-cuda']), spec('rt-cuda')).ok).toBe(true);
    expect(parsed(base(['nope'])).ok).toBe(false);
    expect(parsed(base(['rt'])).ok).toBe(false);
    expect(parsed(base(['rt-cuda']), spec('other', { variants: ['rt-cuda'] }), spec('rt-cuda')).ok).toBe(
      false,
    );
    expect(parsed(base(['rt-cuda']), spec('rt-cuda', { variants: ['rt-vk'] }), spec('rt-vk')).ok).toBe(false);
    expect(parsed(base(['rt-cuda']), spec('rt-cuda', { tiers: ['high'] })).ok).toBe(false);
  });
});

describe('which build of a group runs here', () => {
  const manifest = manifestOf(
    spec('runtime', {
      tiers: ['minimum', 'high'],
      variants: ['runtime-cuda', 'runtime-vulkan'],
      platform: 'any',
    }),
    spec('runtime-cuda', { requires: CUDA_13, dependencies: ['cuda-runtime'] }),
    spec('runtime-vulkan', { requires: { gpuApi: 'vulkan' } }),
    spec('cuda-runtime', { requires: CUDA_13 }),
    spec('model', { tiers: ['high'], platform: 'any', dependencies: ['runtime'] }),
  );
  const fitsOn = (machine: MachineDescription) => (c: ComponentEntry) => machineFit(c, machine).fits;
  const base = manifest.components[0]!;

  it('takes the most preferred variant that fits, else the base', () => {
    expect(chooseVariant(manifest, base, 'linux-x64', fitsOn(RTX_4090_HOST))?.id).toBe('runtime-cuda');
    const amd = { ...CPU_ONLY, gpus: [{ vendor: 'amd', apis: ['vulkan'] }] };
    expect(chooseVariant(manifest, base, 'linux-x64', fitsOn(amd))?.id).toBe('runtime-vulkan');
    expect(chooseVariant(manifest, base, 'linux-x64', fitsOn(CPU_ONLY))?.id).toBe('runtime');
    // No linux build of a variant on a Mac: the base.
    expect(chooseVariant(manifest, base, 'darwin-arm64', () => true)?.id).toBe('runtime');
  });

  it("swaps the tier's picks only: a model still depends on the base it names", () => {
    const picks = (machine: MachineDescription) =>
      tierPicks(manifest, 'high', 'linux-x64', fitsOn(machine)).map((c) => c.id);
    expect(picks(RTX_4090_HOST)).toEqual(['runtime-cuda', 'model']);
    expect(picks(CPU_ONLY)).toEqual(['runtime', 'model']);
  });

  it('logs each group’s choice with the reasons the preferred builds were passed over', () => {
    expect(describeChoices(manifest, 'high', 'linux-x64', { tier: 'high', machine: CPU_ONLY })).toEqual([
      '[components] runtime: runtime (runtime-cuda: no GPU here offers cuda; runtime-vulkan: no GPU here offers vulkan)',
    ]);
    expect(describeChoices(manifest, 'high', 'linux-x64', { tier: 'high', machine: RTX_4090_HOST })).toEqual([
      '[components] runtime: runtime-cuda',
    ]);
    expect(describeChoices(manifest, 'high', 'win32-x64', { tier: 'high' })).toEqual([
      '[components] runtime: runtime (runtime-cuda: no build for win32-x64; runtime-vulkan: no build for win32-x64)',
    ]);
  });
});
