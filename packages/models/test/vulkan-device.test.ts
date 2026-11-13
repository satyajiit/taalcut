// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Vulkan build's device (LNX1-ML): the probe's GPU among the devices `llama-server --list-devices` prints, by
 * name, else by video memory; nothing to pin with one device or no match. The rows are this host's (b11571, an RTX
 * 4090 beside an Intel UHD 770) and a Mesa AMD one.
 */
import { describe, expect, it } from 'vitest';
import { parseListedDevices, vulkanDeviceFor } from '../src/local-runtime/vulkan-device';

const MIB = 1024 ** 2;
const HOST = [
  'Available devices:',
  '  Vulkan0: NVIDIA GeForce RTX 4090 (24564 MiB, 20773 MiB free)',
  '  Vulkan1: Intel(R) Graphics (RPL-S) (47220 MiB, 42498 MiB free)',
];
const MESA = [
  'Available devices:',
  '  Vulkan0: AMD Radeon Graphics (RADV RAPHAEL_MENDOCINO) (31958 MiB, 31000 MiB free)',
  '  Vulkan1: AMD Radeon RX 7900 XTX (RADV NAVI31) (24560 MiB, 23000 MiB free)',
];

describe('parseListedDevices', () => {
  it('reads the id, the name and the whole memory of each row', () => {
    expect(parseListedDevices(HOST)).toEqual([
      { id: 'Vulkan0', name: 'NVIDIA GeForce RTX 4090', totalBytes: 24_564 * MIB },
      { id: 'Vulkan1', name: 'Intel(R) Graphics (RPL-S)', totalBytes: 47_220 * MIB },
    ]);
    expect(parseListedDevices(['  CUDA0: NVIDIA GeForce RTX 4090 (24129 MiB, 20395 MiB free)'])).toEqual([
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', totalBytes: 24_129 * MIB },
    ]);
    expect(parseListedDevices(['load_backend: loaded Vulkan backend', ''])).toEqual([]);
  });
});

describe('vulkanDeviceFor', () => {
  const rtx = { name: 'NVIDIA GeForce RTX 4090', totalVramBytes: 24_564 * MIB };

  it("pins the probe's GPU by name, wherever Vulkan numbers it", () => {
    expect(vulkanDeviceFor(parseListedDevices(HOST), rtx)).toBe('Vulkan0');
    const igpuFirst = [
      '  Vulkan0: Intel(R) Graphics (RPL-S) (47220 MiB, 42498 MiB free)',
      '  Vulkan1: NVIDIA GeForce RTX 4090 (24564 MiB, 20773 MiB free)',
    ];
    expect(vulkanDeviceFor(parseListedDevices(igpuFirst), rtx)).toBe('Vulkan1');
  });

  it('pins by video memory when the names differ (Mesa against the PCI name)', () => {
    const amd = { name: 'Navi 31 [Radeon RX 7900 XT/7900 XTX]', totalVramBytes: 24 * 1024 * MIB };
    expect(vulkanDeviceFor(parseListedDevices(MESA), amd)).toBe('Vulkan1');
  });

  it("leaves llama.cpp's choice with one device, no probe, or nothing that matches", () => {
    expect(vulkanDeviceFor(parseListedDevices(HOST.slice(0, 2)), rtx)).toBeUndefined();
    expect(vulkanDeviceFor(parseListedDevices(HOST), undefined)).toBeUndefined();
    expect(
      vulkanDeviceFor(parseListedDevices(HOST), { name: 'Arc A770', totalVramBytes: 16 * 1024 * MIB }),
    ).toBe(undefined);
  });
});
