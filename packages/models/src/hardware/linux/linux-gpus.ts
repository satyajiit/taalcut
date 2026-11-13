// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The GPUs of a Linux machine (LNX1): each PCI display device the kernel's DRM layer lists (`/sys/class/drm/card*`
 * and `renderD*`, grouped by PCI address), merged with nvidia-smi's rows (matched by PCI address) and the Vulkan
 * drivers installed. An NVIDIA GPU nvidia-smi lists offers `cuda`; a GPU whose kernel driver has a Vulkan ICD (and
 * the Vulkan loader is there) offers `vulkan`. nvidia-smi rows with no DRM device (a compute card without
 * nvidia-drm) are added from nvidia-smi alone. The most VRAM first: the discrete GPU is primary, the iGPU after it.
 */
import { normalizePciBusId, type NvidiaSmiGpu } from '../nvidia-smi';
import type { GpuApi, GpuInfo, GpuVendor } from '../types';
import type { LinuxFs } from './linux-fs';
import {
  gpuDisplayName,
  icdLibrary,
  parseHexId,
  parseSysfsNumber,
  parseUevent,
  PCI_VENDORS,
  vulkanKernelDrivers,
} from './parse-sysfs';

/** One PCI GPU as DRM shows it. */
export interface DrmGpu {
  readonly pciBusId: string;
  readonly vendorId: number;
  readonly deviceId: number;
  readonly kernelDriver?: string;
  readonly renderNode?: string;
  /** amdgpu's `mem_info_vram_total` and `mem_info_vram_used`. */
  readonly vramBytes?: number;
  readonly vramUsedBytes?: number;
}

const DRM = '/sys/class/drm';
export const VULKAN_ICD_DIRS = ['/usr/share/vulkan/icd.d', '/etc/vulkan/icd.d'] as const;
export const VULKAN_LOADERS = [
  '/usr/lib/x86_64-linux-gnu/libvulkan.so.1',
  '/usr/lib/aarch64-linux-gnu/libvulkan.so.1',
  '/usr/lib64/libvulkan.so.1',
  '/usr/lib/libvulkan.so.1',
] as const;
export const PCI_IDS_FILES = ['/usr/share/misc/pci.ids', '/usr/share/hwdata/pci.ids'] as const;

const cardOrder = (name: string) =>
  Number(/\d+$/.exec(name)?.[0] ?? 0) + (name.startsWith('renderD') ? 1e6 : 0);

/** DRM's PCI devices, in card order. Non-PCI displays (simpledrm, virtual) have no PCI_SLOT_NAME and are skipped. */
export async function readDrmGpus(fs: LinuxFs): Promise<DrmGpu[]> {
  const names = (await fs.list(DRM)).filter((n) => /^(card|renderD)\d+$/.test(n));
  const byBus = new Map<string, DrmGpu>();
  for (const name of names.sort((a, b) => cardOrder(a) - cardOrder(b))) {
    const dir = `${DRM}/${name}/device`;
    const uevent = parseUevent((await fs.readText(`${dir}/uevent`)) ?? '');
    const slot = uevent.get('PCI_SLOT_NAME');
    if (!slot) continue;
    const pciBusId = normalizePciBusId(slot);
    let gpu = byBus.get(pciBusId);
    if (!gpu) {
      const [idVendor, idDevice] = (uevent.get('PCI_ID') ?? '').split(':').map((h) => parseHexId(`0x${h}`));
      const vendorId = parseHexId(await fs.readText(`${dir}/vendor`)) ?? idVendor;
      const deviceId = parseHexId(await fs.readText(`${dir}/device`)) ?? idDevice;
      if (vendorId === undefined || deviceId === undefined) continue;
      const kernelDriver = uevent.get('DRIVER');
      const amd = kernelDriver === 'amdgpu';
      const vramBytes = amd ? parseSysfsNumber(await fs.readText(`${dir}/mem_info_vram_total`)) : undefined;
      const vramUsedBytes = amd
        ? parseSysfsNumber(await fs.readText(`${dir}/mem_info_vram_used`))
        : undefined;
      gpu = {
        pciBusId,
        vendorId,
        deviceId,
        ...(kernelDriver ? { kernelDriver } : {}),
        ...(vramBytes ? { vramBytes } : {}),
        ...(vramUsedBytes !== undefined ? { vramUsedBytes } : {}),
      };
    }
    // A container may see sysfs without the device node: only a node that exists counts.
    if (name.startsWith('renderD') && !gpu.renderNode && (await fs.exists(`/dev/dri/${name}`)))
      gpu = { ...gpu, renderNode: `/dev/dri/${name}` };
    byBus.set(pciBusId, gpu);
  }
  return [...byBus.values()];
}

/** Kernel drivers with a Vulkan driver installed; none without the Vulkan loader. */
export async function readVulkanDrivers(fs: LinuxFs): Promise<ReadonlySet<string>> {
  const loaders = await Promise.all(VULKAN_LOADERS.map((path) => fs.exists(path)));
  if (!loaders.some(Boolean)) return new Set();
  const libraries: string[] = [];
  for (const dir of VULKAN_ICD_DIRS)
    for (const file of (await fs.list(dir)).filter((f) => f.endsWith('.json'))) {
      const library = icdLibrary((await fs.readText(`${dir}/${file}`)) ?? '');
      if (library) libraries.push(library);
    }
  return vulkanKernelDrivers(libraries);
}

export interface LinuxGpuInputs {
  readonly drm: readonly DrmGpu[];
  readonly nvidia: readonly NvidiaSmiGpu[];
  /** Kernel drivers with a Vulkan driver (readVulkanDrivers). */
  readonly vulkan: ReadonlySet<string>;
  /** pci.ids' name for a device, e.g. 'Raptor Lake-S GT1 [UHD Graphics 770]'. */
  readonly pciName: (vendorId: number, deviceId: number) => string | undefined;
}

const VENDOR_RANK: Readonly<Record<GpuVendor, number>> = { nvidia: 0, amd: 1, intel: 2, apple: 3, other: 4 };

export function linuxGpus({ drm, nvidia, vulkan, pciName }: LinuxGpuInputs): GpuInfo[] {
  const unmatched = [...nvidia];
  const take = (bus: string) => {
    const at = unmatched.findIndex((row) => row.pciBusId === bus);
    return at >= 0 ? unmatched.splice(at, 1)[0] : undefined;
  };
  const gpus = drm.map((device): GpuInfo => {
    const vendor = PCI_VENDORS[device.vendorId] ?? 'other';
    const smi = vendor === 'nvidia' ? take(device.pciBusId) : undefined;
    const name =
      smi?.name ??
      gpuDisplayName(vendor, device.vendorId, device.deviceId, pciName(device.vendorId, device.deviceId));
    const vramBytes = smi?.vramBytes ?? device.vramBytes;
    const used = smi ? smi.vramUsedBytes : device.vramUsedBytes;
    return {
      name,
      vendor,
      ...(vramBytes ? { vramBytes } : {}),
      ...(vramBytes && used !== undefined ? { vramFreeBytes: Math.max(0, vramBytes - used) } : {}),
      // Integrated GPUs share system memory, but only Apple's unified memory counts as GPU memory here.
      unifiedMemory: false,
      apis: apisOf(smi !== undefined, device.kernelDriver, vulkan),
      ...(smi ? nvidiaFacts(smi) : {}),
      pciBusId: device.pciBusId,
      ...(device.renderNode ? { renderNode: device.renderNode } : {}),
      ...(device.kernelDriver ? { kernelDriver: device.kernelDriver } : {}),
    };
  });
  // nvidia-smi rows DRM doesn't list: a compute GPU without nvidia-drm loaded.
  for (const smi of unmatched)
    gpus.push({
      name: smi.name,
      vendor: 'nvidia',
      vramBytes: smi.vramBytes,
      ...(smi.vramUsedBytes !== undefined
        ? { vramFreeBytes: Math.max(0, smi.vramBytes - smi.vramUsedBytes) }
        : {}),
      unifiedMemory: false,
      apis: apisOf(true, 'nvidia', vulkan),
      ...nvidiaFacts(smi),
      ...(smi.pciBusId ? { pciBusId: smi.pciBusId } : {}),
      kernelDriver: 'nvidia',
    });
  return gpus.sort(
    (a, b) => (b.vramBytes ?? 0) - (a.vramBytes ?? 0) || VENDOR_RANK[a.vendor] - VENDOR_RANK[b.vendor],
  );
}

function apisOf(cuda: boolean, kernelDriver: string | undefined, vulkan: ReadonlySet<string>): GpuApi[] {
  const apis: GpuApi[] = [];
  if (cuda) apis.push('cuda');
  if (kernelDriver && vulkan.has(kernelDriver)) apis.push('vulkan');
  return apis;
}

const nvidiaFacts = (smi: NvidiaSmiGpu) => ({
  driverVersion: smi.driverVersion,
  ...(smi.computeCapability ? { computeCapability: smi.computeCapability } : {}),
  ...(smi.index !== undefined ? { index: smi.index } : {}),
});
