// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which Vulkan device the Vulkan build of llama-server runs on (LNX1). Left to itself, llama.cpp splits the layers
 * over every Vulkan device, an integrated GPU included, by free memory, and an integrated GPU's "free memory" is
 * system RAM: on an RTX 4090 beside an Intel UHD 770, Qwen3.5 4B ran 43 tokens/s split and 198 pinned to the 4090.
 * Vulkan numbers its devices in the loader's order, which the probe doesn't see, so the driver asks the build
 * (`llama-server --list-devices`) and pins the device that is the probe's GPU: the same name (NVIDIA's Vulkan and
 * nvidia-smi names agree), else the same video memory within a tenth (Mesa's names don't match the PCI names).
 */

/** One row of `llama-server --list-devices`. */
export interface ListedDevice {
  /** `Vulkan0`, `CUDA0`: what `--device` takes. */
  readonly id: string;
  readonly name: string;
  readonly totalBytes?: number;
}

/** The GPU the probe chose, as the driver knows it. */
export interface ProbedGpu {
  readonly name?: string;
  readonly totalVramBytes?: number;
}

const MIB = 1024 * 1024;
/** `  Vulkan0: NVIDIA GeForce RTX 4090 (24564 MiB, 20773 MiB free)`. */
const ROW = /^\s*([A-Za-z]+\d+):\s*(.+?)\s*(?:\((\d+) MiB(?:,\s*\d+ MiB free)?\))?\s*$/;

export function parseListedDevices(lines: readonly string[]): ListedDevice[] {
  const rows: ListedDevice[] = [];
  for (const line of lines) {
    const match = ROW.exec(line);
    if (!match?.[1] || !match[2]) continue;
    rows.push({
      id: match[1],
      name: match[2],
      ...(match[3] ? { totalBytes: Number(match[3]) * MIB } : {}),
    });
  }
  return rows;
}

const normal = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The `--device` for the Vulkan build: the listed Vulkan device that is the probe's GPU. Undefined with one Vulkan
 * device (nothing to choose) or when none matches (llama.cpp's own choice).
 */
export function vulkanDeviceFor(
  listed: readonly ListedDevice[],
  gpu: ProbedGpu | undefined,
): string | undefined {
  const vulkan = listed.filter((device) => device.id.startsWith('Vulkan'));
  if (vulkan.length < 2 || !gpu) return undefined;
  const name = gpu.name ? normal(gpu.name) : undefined;
  const named = name
    ? vulkan.find((device) => normal(device.name).includes(name) || name.includes(normal(device.name)))
    : undefined;
  if (named) return named.id;
  const total = gpu.totalVramBytes;
  if (!total) return undefined;
  const near = vulkan
    .filter((device) => device.totalBytes !== undefined && Math.abs(device.totalBytes - total) <= total / 10)
    .sort((a, b) => Math.abs(a.totalBytes! - total) - Math.abs(b.totalBytes! - total));
  return near[0]?.id;
}
