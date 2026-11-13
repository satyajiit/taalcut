// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A GPU's vendor from the vendor and model names a platform tool reports (system_profiler, CIM). */
import type { GpuVendor } from './types';

export function gpuVendorOf(text: string): GpuVendor {
  if (/apple/i.test(text)) return 'apple';
  if (/nvidia|geforce|quadro/i.test(text)) return 'nvidia';
  if (/\bamd\b|advanced micro devices|radeon|\bati\b/i.test(text)) return 'amd';
  if (/intel/i.test(text)) return 'intel';
  return 'other';
}
