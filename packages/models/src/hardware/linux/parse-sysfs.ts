// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Parsers for what Linux says about GPUs: a DRM device's sysfs files (`vendor`, `device`, `uevent`), the PCI ID
 * database (`pci.ids`, from pciutils/hwdata) for names, and Vulkan ICD manifests. Pure, so fixtures test them.
 */
import type { GpuVendor } from '../types';

/** PCI vendor IDs of the GPU makers Taalcut knows. */
export const PCI_VENDORS: Readonly<Record<number, GpuVendor>> = {
  0x10de: 'nvidia',
  0x8086: 'intel',
  0x1002: 'amd',
};

/** `KEY=value` lines (sysfs uevent). */
export function parseUevent(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return values;
}

/** '0x10de\n' → 0x10de. */
export function parseHexId(text: string | undefined): number | undefined {
  const match = /^0x([0-9a-f]{1,4})$/i.exec(text?.trim() ?? '');
  return match ? Number.parseInt(match[1] ?? '', 16) : undefined;
}

/** A sysfs number (amdgpu's `mem_info_vram_total`, in bytes). */
export function parseSysfsNumber(text: string | undefined): number | undefined {
  const match = /^(\d+)$/.exec(text?.trim() ?? '');
  return match ? Number(match[1]) : undefined;
}

const hex4 = (id: number) => id.toString(16).padStart(4, '0');

/**
 * The device's name in pci.ids, e.g. 'AD102 [GeForce RTX 4090]'. Vendor lines start at column 0 ('10de  NVIDIA
 * Corporation'), their devices follow indented by one tab, subsystems by two.
 */
export function pciDeviceName(ids: string, vendorId: number, deviceId: number): string | undefined {
  const vendorLine = `${hex4(vendorId)}  `;
  const start = ids.startsWith(vendorLine) ? 0 : ids.indexOf(`\n${vendorLine}`);
  if (start < 0) return undefined;
  const lines = ids.slice(start === 0 ? 0 : start + 1).split('\n');
  const deviceLine = `\t${hex4(deviceId)}  `;
  for (const line of lines.slice(1)) {
    if (line.startsWith('#') || line.startsWith('\t\t')) continue;
    if (!line.startsWith('\t')) return undefined;
    if (line.toLowerCase().startsWith(deviceLine)) return line.slice(deviceLine.length).trim() || undefined;
  }
  return undefined;
}

const BRAND: Readonly<Record<GpuVendor, string>> = {
  nvidia: 'NVIDIA',
  intel: 'Intel',
  amd: 'AMD',
  apple: 'Apple',
  other: '',
};

/**
 * What the UI shows: the marketing name in pci.ids' brackets with the vendor's brand ('Raptor Lake-S GT1 [UHD
 * Graphics 770]' → 'Intel UHD Graphics 770'), else the whole entry, else the PCI IDs.
 */
export function gpuDisplayName(
  vendor: GpuVendor,
  vendorId: number,
  deviceId: number,
  pciName: string | undefined,
): string {
  const brand = BRAND[vendor];
  if (!pciName) return `${brand || 'GPU'} ${hex4(vendorId)}:${hex4(deviceId)}`.trim();
  const marketing = /\[([^\]]+)\]\s*$/.exec(pciName)?.[1] ?? pciName;
  return !brand || marketing.toLowerCase().startsWith(brand.toLowerCase())
    ? marketing
    : `${brand} ${marketing}`;
}

/** The kernel drivers whose GPUs each Vulkan driver (by its ICD's library) serves. */
const ICD_DRIVERS: readonly { readonly library: RegExp; readonly kernelDrivers: readonly string[] }[] = [
  { library: /libGLX_nvidia\.so|libnvidia-vulkan/, kernelDrivers: ['nvidia'] },
  { library: /libvulkan_nouveau\.so/, kernelDrivers: ['nouveau'] },
  { library: /libvulkan_intel(_hasvk)?\.so/, kernelDrivers: ['i915', 'xe'] },
  { library: /libvulkan_radeon\.so|amdvlk/, kernelDrivers: ['amdgpu'] },
];

/** An ICD manifest's `ICD.library_path`; undefined when it isn't one. */
export function icdLibrary(json: string): string | undefined {
  try {
    const path = (JSON.parse(json) as { ICD?: { library_path?: unknown } }).ICD?.library_path;
    return typeof path === 'string' && path.length > 0 ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Kernel drivers with a Vulkan driver installed, from the ICD libraries found. */
export function vulkanKernelDrivers(libraries: readonly string[]): ReadonlySet<string> {
  const drivers = new Set<string>();
  for (const library of libraries)
    for (const icd of ICD_DRIVERS)
      if (icd.library.test(library)) icd.kernelDrivers.forEach((d) => drivers.add(d));
  return drivers;
}
