// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LNX1-HW: the Linux probe's pure parsers and the environment switches. */
import { describe, expect, it } from 'vitest';
import { applyAcceleratorEnv, cudaVisibility, forceCpuFrom, type GpuInfo } from '@taalcut/models';
import { normalizePciBusId } from '../src/hardware/nvidia-smi';
import {
  countCpuList,
  parseCpuinfo,
  parseMemTotal,
  parseOsRelease,
  versionParts,
} from '../src/hardware/linux/parse-proc';
import {
  gpuDisplayName,
  icdLibrary,
  parseHexId,
  parseUevent,
  pciDeviceName,
  vulkanKernelDrivers,
} from '../src/hardware/linux/parse-sysfs';

describe('proc and os-release', () => {
  it('reads the first model name and counts logical CPUs; ARM kernels print no model name', () => {
    expect(
      parseCpuinfo('processor\t: 0\nmodel name\t: Intel(R) Core(TM) i9\n\nprocessor\t: 1\nmodel name\t: x\n'),
    ).toEqual({ model: 'Intel(R) Core(TM) i9', logical: 2 });
    expect(parseCpuinfo('processor\t: 0\nBogoMIPS\t: 48.00\nCPU implementer\t: 0x41\n')).toEqual({
      logical: 1,
    });
  });

  it('reads MemTotal in KiB', () => {
    expect(parseMemTotal('MemTotal:       64472228 kB\nMemFree: 1 kB\n')).toBe(64472228 * 1024);
    expect(parseMemTotal('MemFree: 1 kB\n')).toBeUndefined();
  });

  it("reads os-release's quoting", () => {
    const os = parseOsRelease(
      'PRETTY_NAME="Ubuntu 24.04.5 LTS"\nID=ubuntu\nNAME=\'Arch\'\nX="a \\"b\\""\n# c\n',
    );
    expect(os.get('PRETTY_NAME')).toBe('Ubuntu 24.04.5 LTS');
    expect(os.get('ID')).toBe('ubuntu');
    expect(os.get('NAME')).toBe('Arch');
    expect(os.get('X')).toBe('a "b"');
  });

  it('counts sysfs CPU lists, and versions', () => {
    expect(countCpuList('0-15\n')).toBe(16);
    expect(countCpuList('0-7,16-23')).toBe(16);
    expect(countCpuList('3')).toBe(1);
    expect(countCpuList('')).toBe(0);
    expect(countCpuList('7-3')).toBe(0);
    expect(versionParts('22.04.5')).toEqual([22, 4]);
    expect(versionParts('40')).toEqual([40, 0]);
    expect(versionParts('rolling')).toBeUndefined();
  });
});

describe('sysfs, pci.ids and Vulkan ICDs', () => {
  it('reads uevent and hex ids', () => {
    const uevent = parseUevent('DRIVER=nvidia\nPCI_ID=10DE:2684\nPCI_SLOT_NAME=0000:01:00.0\n');
    expect(uevent.get('DRIVER')).toBe('nvidia');
    expect(uevent.get('PCI_SLOT_NAME')).toBe('0000:01:00.0');
    expect(parseHexId('0x10de\n')).toBe(0x10de);
    expect(parseHexId('10de')).toBeUndefined();
  });

  it("finds a device in its own vendor's block only", () => {
    const ids =
      '#\n1002  Advanced Micro Devices, Inc. [AMD/ATI]\n\t164e  Raphael\n\t\t1458 d000  Sub\n' +
      '14e4  Broadcom Inc. and subsidiaries\n\t164e  NetXtreme II BCM57710\n' +
      '8086  Intel Corporation\n# a comment\n\ta780  Raptor Lake-S GT1 [UHD Graphics 770]\n';
    expect(pciDeviceName(ids, 0x1002, 0x164e)).toBe('Raphael');
    expect(pciDeviceName(ids, 0x8086, 0xa780)).toBe('Raptor Lake-S GT1 [UHD Graphics 770]');
    expect(pciDeviceName(ids, 0x1002, 0xa780)).toBeUndefined();
    expect(pciDeviceName(ids, 0x10de, 0x2684)).toBeUndefined();
    expect(pciDeviceName('', 0x10de, 0x2684)).toBeUndefined();
  });

  it('names a GPU by its bracketed marketing name with the brand, else the entry, else the ids', () => {
    expect(gpuDisplayName('intel', 0x8086, 0xa780, 'Raptor Lake-S GT1 [UHD Graphics 770]')).toBe(
      'Intel UHD Graphics 770',
    );
    expect(gpuDisplayName('nvidia', 0x10de, 0x2684, 'AD102 [GeForce RTX 4090]')).toBe(
      'NVIDIA GeForce RTX 4090',
    );
    expect(gpuDisplayName('amd', 0x1002, 0x164e, 'Raphael')).toBe('AMD Raphael');
    expect(gpuDisplayName('other', 0x1a03, 0x2000, 'ASPEED Graphics Family')).toBe('ASPEED Graphics Family');
    expect(gpuDisplayName('amd', 0x1002, 0x7480, undefined)).toBe('AMD 1002:7480');
    expect(gpuDisplayName('other', 0x1af4, 0x1050, undefined)).toBe('GPU 1af4:1050');
  });

  it('matches Vulkan drivers to kernel drivers by their ICD library', () => {
    expect(icdLibrary('{"ICD": {"library_path": "libGLX_nvidia.so.0"}}')).toBe('libGLX_nvidia.so.0');
    expect(icdLibrary('not json')).toBeUndefined();
    const drivers = vulkanKernelDrivers([
      'libGLX_nvidia.so.0',
      'libvulkan_intel.so',
      '/opt/amdvlk/amdvlk64.so',
      'libvulkan_lvp.so',
    ]);
    expect([...drivers].sort()).toEqual(['amdgpu', 'i915', 'nvidia', 'xe']);
  });

  it("normalises nvidia-smi's PCI address to Linux's", () => {
    expect(normalizePciBusId('00000000:01:00.0')).toBe('0000:01:00.0');
    expect(normalizePciBusId('0000:4A:00.0')).toBe('0000:4a:00.0');
  });
});

describe('environment switches', () => {
  const nvidia = (index: number): GpuInfo => ({
    name: `GPU ${index}`,
    vendor: 'nvidia',
    unifiedMemory: false,
    apis: ['cuda', 'vulkan'],
    index,
  });

  it('reads CUDA_VISIBLE_DEVICES as CUDA does: in order, up to the first entry that is no GPU', () => {
    expect(cudaVisibility(undefined, [0, 1])).toBe('all');
    expect(cudaVisibility('-1', [0, 1])).toEqual(new Map());
    expect(cudaVisibility('', [0, 1])).toEqual(new Map());
    expect(cudaVisibility('1,0', [0, 1])).toEqual(
      new Map([
        [1, 0],
        [0, 1],
      ]),
    );
    expect(cudaVisibility('0,5,1', [0, 1])).toEqual(new Map([[0, 0]]));
    expect(cudaVisibility(' 1 ', [0, 1])).toEqual(new Map([[1, 0]]));
    expect(cudaVisibility('GPU-8f2a', [0, 1])).toBe('unresolved');
  });

  it('gives each shown GPU its CUDA ordinal and takes cuda from the hidden ones', () => {
    const { gpus, forcedCpu } = applyAcceleratorEnv([nvidia(0), nvidia(1)], { CUDA_VISIBLE_DEVICES: '1' });
    expect(forcedCpu).toBe(false);
    expect(gpus.map((g) => [g.apis, g.cudaDeviceId])).toEqual([
      [['vulkan'], undefined],
      [['cuda', 'vulkan'], 0],
    ]);
    const unresolved = applyAcceleratorEnv([nvidia(0)], { CUDA_VISIBLE_DEVICES: 'GPU-8f2a' }).gpus[0];
    expect(unresolved).toEqual(nvidia(0));
  });

  it('TAALCUT_FORCE_CPU takes every API from every GPU', () => {
    expect(forceCpuFrom({ TAALCUT_FORCE_CPU: '1' })).toBe(true);
    expect(forceCpuFrom({ TAALCUT_FORCE_CPU: 'TRUE' })).toBe(true);
    expect(forceCpuFrom({ TAALCUT_FORCE_CPU: '0' })).toBe(false);
    expect(forceCpuFrom({})).toBe(false);
    const forced = applyAcceleratorEnv([nvidia(0)], { TAALCUT_FORCE_CPU: '1', CUDA_VISIBLE_DEVICES: '0' });
    expect(forced).toEqual({ gpus: [{ ...nvidia(0), apis: [] }], forcedCpu: true });
  });
});
