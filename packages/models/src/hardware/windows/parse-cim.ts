// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Windows facts from one PowerShell call (round IX, IX-S6): CIM's Win32_Processor, Win32_OperatingSystem,
 * Win32_ComputerSystem and Win32_VideoController, plus each display adapter's memory from the registry
 * (`HardwareInformation.qwMemorySize`, the 64-bit value the driver writes; CIM's `AdapterRAM` is a 32-bit
 * field that stops at 4 GiB). The script prints JSON; it is validated here, since it is process output.
 * Not run on real Windows hardware this round: the tests replay output shaped like PowerShell 5.1's.
 */
import { z } from 'zod';

/** The registry class of display adapters. */
const DISPLAY_CLASS =
  'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';

/** One JSON object on stdout; `@(...)` keeps one-element lists as lists. */
export const CIM_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$cpu = @(Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)',
  '$os = Get-CimInstance Win32_OperatingSystem | Select-Object Version, Caption',
  '$cs = Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory',
  '$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, AdapterCompatibility, AdapterRAM, DriverVersion)',
  `$mem = @(Get-ItemProperty '${DISPLAY_CLASS}\\0*' -ErrorAction SilentlyContinue | ` +
    "Select-Object DriverDesc, @{ n = 'Bytes'; e = { $_.'HardwareInformation.qwMemorySize' } })",
  '[pscustomobject]@{ cpu = $cpu; os = $os; memory = $cs.TotalPhysicalMemory; gpus = $gpus; adapterMemory = $mem } ' +
    '| ConvertTo-Json -Depth 4 -Compress',
].join('; ');

const count = z.int().nonnegative();
/** PowerShell 5.1 writes a one-element array as the element itself when `@()` is lost on the way. */
const list = <T extends z.ZodType>(item: T) => z.union([z.array(item), item.transform((one) => [one])]);

export const cimOutputSchema = z.object({
  cpu: list(
    z.object({
      Name: z.string(),
      NumberOfCores: count,
      NumberOfLogicalProcessors: count.nullable().optional(),
    }),
  ),
  os: z.object({ Version: z.string().regex(/^\d+(\.\d+){1,3}$/), Caption: z.string().optional() }),
  memory: z.number().nonnegative(),
  gpus: list(
    z.object({
      Name: z.string(),
      AdapterCompatibility: z.string().nullable().optional(),
      AdapterRAM: z.number().nonnegative().nullable().optional(),
      DriverVersion: z.string().nullable().optional(),
    }),
  ),
  adapterMemory: list(
    z.object({
      DriverDesc: z.string().nullable().optional(),
      Bytes: z.number().nonnegative().nullable().optional(),
    }),
  )
    .nullable()
    .optional(),
});
export type CimOutput = z.output<typeof cimOutputSchema>;

/** Parsed and validated, or the reason it isn't. */
export function parseCim(stdout: string): { ok: true; value: CimOutput } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    return { ok: false, reason: 'PowerShell printed no JSON.' };
  }
  const parsed = cimOutputSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: parsed.error.message };
}
