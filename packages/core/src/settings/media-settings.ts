// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Media's settings that the renderer's Settings → Storage reads and writes. */
import '../basics/zod-config';
import { z } from 'zod';
import { defineSetting } from '../ports/preferences';

const GB = 1_000_000_000;

/** Media cache cap (PRD Storage, ADR 0001 "Cache caps"). Decimal GB, as Finder shows sizes. */
export const MEDIA_CACHE_CAP_SETTING = defineSetting(
  'media.cacheCapBytes',
  z
    .int()
    .min(2 * GB)
    .max(2_000 * GB),
  20 * GB,
);
