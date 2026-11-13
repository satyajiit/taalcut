// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Parsers for macOS tool output: sysctl, system_profiler (JSON) and sw_vers. Pure, so fixtures test them. */
import { gpuVendorOf } from './gpu-vendor';
import type { AppleChip, GpuInfo } from './types';

/** `sysctl a b c` prints "name: value" per line; unknown names go to stderr. */
export function parseSysctl(stdout: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const at = line.indexOf(': ');
    if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 2).trim());
  }
  return values;
}

/** 'Apple M3 Max' → { generation: 3, variant: 'max' }. Intel brand strings give undefined. */
export function parseAppleChip(brand: string): AppleChip | undefined {
  const match = /\bApple M(\d+)(?:\s+(Pro|Max|Ultra))?\b/i.exec(brand);
  if (!match) return undefined;
  const variant = (match[2]?.toLowerCase() ?? 'base') as AppleChip['variant'];
  return { generation: Number(match[1]), variant };
}

interface DisplayJson {
  _name?: string;
  sppci_model?: string;
  sppci_cores?: string | number;
  sppci_device_type?: string;
  spdisplays_vendor?: string;
  spdisplays_vram?: string;
  spdisplays_mtlgpufamilysupport?: string;
}

/**
 * GPUs from `system_profiler SPDisplaysDataType -json`, primary first: the
 * Apple GPU, else the discrete GPU with the most memory. macOS 10.14 and later
 * run only on Metal GPUs; `spdisplays_mtlgpufamilysupport` names the family.
 */
export function parseGpus(json: string): GpuInfo[] {
  let entries: DisplayJson[];
  try {
    entries = (JSON.parse(json) as { SPDisplaysDataType?: DisplayJson[] }).SPDisplaysDataType ?? [];
  } catch {
    return [];
  }
  const gpus = entries
    .filter((d) => d.sppci_device_type === undefined || d.sppci_device_type === 'spdisplays_gpu')
    .map((d): GpuInfo => {
      const name = d.sppci_model ?? d._name ?? 'GPU';
      const vendor = gpuVendorOf(`${d.spdisplays_vendor ?? ''} ${name}`);
      const cores = Number(d.sppci_cores);
      const vramBytes = parseSize(d.spdisplays_vram);
      const metalFamily = d.spdisplays_mtlgpufamilysupport?.replace(/^spdisplays_/, '');
      return {
        name,
        vendor,
        ...(Number.isInteger(cores) && cores > 0 ? { cores } : {}),
        ...(vramBytes !== undefined ? { vramBytes } : {}),
        unifiedMemory: vendor === 'apple',
        apis: metalFamily || vendor === 'apple' ? ['metal'] : [],
        ...(metalFamily ? { metalFamily } : {}),
      };
    });
  const rank = (g: GpuInfo) => (g.vendor === 'apple' ? Number.MAX_SAFE_INTEGER : (g.vramBytes ?? 0));
  return gpus.sort((a, b) => rank(b) - rank(a));
}

/** GPU core count of the primary GPU. Apple Silicon reports `sppci_cores`. */
export function parseGpuCores(json: string): number | undefined {
  return parseGpus(json).find((g) => g.cores !== undefined)?.cores;
}

/** '4 GB' or '1536 MB' → bytes. */
function parseSize(text: string | undefined): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(MB|GB)$/i.exec(text?.trim() ?? '');
  if (!match) return undefined;
  return Number(match[1]) * 1024 ** (match[2]?.toUpperCase() === 'GB' ? 3 : 2);
}

/** `sw_vers -productVersion` → '15.1'. */
export function parseOsVersion(stdout: string): string | undefined {
  const version = stdout.trim();
  return /^\d+(\.\d+){0,2}$/.test(version) ? version : undefined;
}

export function majorVersion(version: string): number {
  return Number(version.split('.')[0]);
}
