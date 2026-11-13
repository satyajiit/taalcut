// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardData } from '@taalcut/ui';
import type { Backend } from '../backend/backend';
import type { MediaUrls } from '../backend/media';
import { looksCardData } from '../features/brand/looks-card-data';
import { hubCardData } from '../features/templates/hub/hub-card-data';
import { cleanupCardData } from '../features/timeline/cleanup/cleanup-card-data';
import { gapsCardData } from '../features/timeline/gaps/gaps-card-data';
import { variantsCardData } from '../features/timeline/variants/variants-card-data';

/** What Phase 3's cards read (packages/ui CardDataPhase3), each from its own area. */
export function phase3CardData(backend: Backend, media: MediaUrls): Partial<CardData> {
  return {
    ...variantsCardData(backend),
    ...gapsCardData(backend, media),
    ...hubCardData(backend),
    ...cleanupCardData(backend),
    ...looksCardData(backend, media),
  };
}
