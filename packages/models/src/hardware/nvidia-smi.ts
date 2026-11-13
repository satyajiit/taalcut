// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * NVIDIA GPUs from `nvidia-smi --query-gpu=… --format=csv`, on Windows (round IX, IX-S6) and Linux (LNX1): a header
 * line naming the columns, then one line per GPU, e.g.
 * `0, NVIDIA GeForce RTX 4090, 24564 MiB, 3474 MiB, 615.71.09, 8.9, 00000000:01:00.0`. Columns are read by the
 * header, so the older three-column query (`name, memory.total [MiB], driver_version`) still parses. nvidia-smi
 * reads NVML, which ignores CUDA_VISIBLE_DEVICES: it lists every GPU. Validated here, since it is process output.
 */
import { z } from 'zod';
import type { CommandRunner } from './command-runner';

const COLUMNS = [
  'index',
  'name',
  'memory.total',
  'memory.used',
  'driver_version',
  'compute_cap',
  'pci.bus_id',
];
export const NVIDIA_SMI_ARGS = [`--query-gpu=${COLUMNS.join(',')}`, '--format=csv'] as const;
/** Drivers before R510 don't know `compute_cap` and refuse the whole query. */
export const NVIDIA_SMI_LEGACY_ARGS = [
  `--query-gpu=${COLUMNS.filter((c) => c !== 'compute_cap').join(',')}`,
  '--format=csv',
] as const;

const MIB = 1024 ** 2;

const rowSchema = z.object({
  name: z.string().min(1).max(200),
  vramBytes: z.number().int().positive(),
  driverVersion: z.string().regex(/^\d+(\.\d+)+$/),
  vramUsedBytes: z.number().int().nonnegative().optional(),
  index: z.int().nonnegative().optional(),
  computeCapability: z
    .string()
    .regex(/^\d+\.\d+$/)
    .optional(),
  pciBusId: z.string().optional(),
});
export type NvidiaSmiGpu = z.output<typeof rowSchema>;

/** '24564 MiB' (or '24564' with nounits) → bytes; '[N/A]' → undefined. */
const mib = (text: string | undefined): number | undefined => {
  const match = /^(\d+)(\s*MiB)?$/i.exec(text ?? '');
  return match ? Number(match[1]) * MIB : undefined;
};

/** 'memory.total [MiB]' → 'memory.total'. */
const columnOf = (header: string) => header.replace(/\s*\[.*\]$/, '').trim();

const isNa = (value: string | undefined) => value === undefined || /^\[.*\]$/.test(value) || value === '';

/** PCI address as Linux writes it: nvidia-smi's 8-digit domain cut to 4, lower case ('0000:01:00.0'). */
export function normalizePciBusId(id: string): string {
  const match = /^([0-9a-f]+):([0-9a-f]{2}):([0-9a-f]{2})\.([0-7])$/i.exec(id.trim());
  if (!match) return id.trim().toLowerCase();
  const [, domain = '', bus, device, fn] = match;
  return `${domain.slice(-4).padStart(4, '0')}:${bus}:${device}.${fn}`.toLowerCase();
}

/** The GPUs listed, in nvidia-smi's order; an empty list when the output isn't nvidia-smi's CSV. */
export function parseNvidiaSmi(stdout: string): NvidiaSmiGpu[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const header = (lines[0] ?? '').split(',').map(columnOf);
  const at = (column: string) => header.indexOf(column);
  if (at('name') < 0 || at('memory.total') < 0 || at('driver_version') < 0) return [];
  const gpus: NvidiaSmiGpu[] = [];
  for (const line of lines.slice(1)) {
    let fields = line.split(',').map((field) => field.trim());
    if (fields.length < header.length) return [];
    // The name may hold commas only in theory; fold the extra fields back into it.
    const extra = fields.length - header.length;
    const nameAt = at('name');
    if (extra > 0)
      fields = [
        ...fields.slice(0, nameAt),
        fields.slice(nameAt, nameAt + extra + 1).join(', '),
        ...fields.slice(nameAt + extra + 1),
      ];
    const field = (column: string) => (at(column) >= 0 ? fields[at(column)] : undefined);
    const used = mib(field('memory.used'));
    const index = field('index');
    const cc = field('compute_cap');
    const bus = field('pci.bus_id');
    const parsed = rowSchema.safeParse({
      name: field('name'),
      vramBytes: mib(field('memory.total')) ?? NaN,
      driverVersion: field('driver_version'),
      ...(used !== undefined ? { vramUsedBytes: used } : {}),
      ...(!isNa(index) && /^\d+$/.test(index ?? '') ? { index: Number(index) } : {}),
      ...(!isNa(cc) ? { computeCapability: cc } : {}),
      ...(!isNa(bus) ? { pciBusId: normalizePciBusId(bus!) } : {}),
    });
    if (!parsed.success) return [];
    gpus.push(parsed.data);
  }
  return gpus;
}

/** The wide query, then the one without `compute_cap` for drivers that refuse it; an empty list when both fail. */
export async function queryNvidiaSmi(
  run: CommandRunner,
  file: string,
  options: { readonly signal?: AbortSignal },
): Promise<NvidiaSmiGpu[]> {
  for (const args of [NVIDIA_SMI_ARGS, NVIDIA_SMI_LEGACY_ARGS]) {
    const out = await run(file, args, options);
    const gpus = out.exitCode === 0 ? parseNvidiaSmi(out.stdout) : [];
    if (gpus.length > 0) return gpus;
  }
  return [];
}
