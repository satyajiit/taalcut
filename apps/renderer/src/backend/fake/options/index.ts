// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Phase2FakeOptions } from '../fake-phase2';
import type { FakeMakeOptions } from '../make/make-options';
import type { Phase3FakeOptions } from '../phase3/fake-phase3';
import type { AreaOptions, AreaOptionsReader } from './area-options';
import { brandOptions } from './brand';
import { cleanupOptions } from './cleanup';
import { commentsOptions } from './comments';
import { energyOptions } from './energy';
import { exportOptions } from './export';
import { fitOptions } from './fit';
import { gapsOptions } from './gaps';
import { hubOptions } from './hub';
import { libraryOptions } from './library';
import { mediaOptions } from './media';
import { memoryOptions } from './memory';
import { recipesOptions } from './recipes';
import { styleProfileOptions } from './style-profiles';
import { templateMediaOptions } from './template-media';
import { templateSearchOptions } from './template-search';
import { variantsOptions } from './variants';

const READERS: readonly AreaOptionsReader[] = [
  recipesOptions,
  libraryOptions,
  hubOptions,
  brandOptions,
  energyOptions,
  cleanupOptions,
  gapsOptions,
  variantsOptions,
  exportOptions,
  mediaOptions,
  fitOptions,
  memoryOptions,
  commentsOptions,
  styleProfileOptions,
  templateSearchOptions,
  templateMediaOptions,
];

type Group = Phase2FakeOptions | FakeMakeOptions | Phase3FakeOptions;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Two levels deep: an area's `templates` (or `areas.gaps`) joins the base's, not replacing it. */
function mergeRecord(base: Record<string, unknown>, extra: Record<string, unknown>, depth: number) {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const before = out[key];
    out[key] =
      depth > 0 && isRecord(before) && isRecord(value) ? mergeRecord(before, value, depth - 1) : value;
  }
  return out;
}

function merge<T extends Group>(base: T, extra: T | undefined): T {
  return extra ? (mergeRecord({ ...base }, { ...extra }, 1) as T) : base;
}

/** The base options with every area's own options from `taalcut.fake` merged in. */
export function withAreaOptions(base: Required<AreaOptions>): Required<AreaOptions> {
  let stored: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem('taalcut.fake') ?? '{}');
    if (raw && typeof raw === 'object') stored = raw as Record<string, unknown>;
  } catch {
    // Storage blocked or not JSON: the base options stand.
  }
  return READERS.map((read) => read(stored)).reduce<Required<AreaOptions>>(
    (all, area) => ({
      phase2: merge(all.phase2, area.phase2),
      make: merge(all.make, area.make),
      phase3: merge(all.phase3, area.phase3),
    }),
    base,
  );
}
