// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf } from '@taalcut/core';
import { CLEANUP_PLAN_FIXTURES } from './fixtures-cleanup';
import { GAP_FIX_FIXTURES } from './fixtures-gaps';
import { HUB_RESULTS_FIXTURES } from './fixtures-hub';
import { STYLE_BATCH_FIXTURES } from './fixtures-looks';
import {
  IMAGE_TAKES_FIXTURES,
  MOTION_GRAPHIC_FIXTURES,
  VOICE_CONSENT_FIXTURES,
  VOICEOVER_FIXTURES,
} from './fixtures-media';
import { DESIGN_GRAPHIC_FIXTURES } from './fixtures-designs';
import { RATE_LIMIT_FIXTURES } from './fixtures-rate-limit';
import { RENDER_BATCH_FIXTURES, VARIANTS_COMPARE_FIXTURES } from './fixtures-variants';
import type { Phase3CardType } from './pending-card';

/**
 * Sample payloads for Phase 3's cards (contract round P3-1), in the states each card has; fixtures.ts spreads them
 * into CARD_FIXTURES. Each area keeps its own file (fixtures-<area>.ts) and its states.
 */
export const PHASE3_FIXTURES: {
  readonly [T in Phase3CardType]: Readonly<Record<string, CardOf<T>>>;
} = {
  rateLimit: RATE_LIMIT_FIXTURES,
  variantsCompare: VARIANTS_COMPARE_FIXTURES,
  gapFix: GAP_FIX_FIXTURES,
  hubResults: HUB_RESULTS_FIXTURES,
  cleanupPlan: CLEANUP_PLAN_FIXTURES,
  styleBatch: STYLE_BATCH_FIXTURES,
  voiceover: VOICEOVER_FIXTURES,
  voiceConsent: VOICE_CONSENT_FIXTURES,
  // HFW1-UI: graphics the AI designed beside the kit's (retired with them).
  motionGraphic: { ...MOTION_GRAPHIC_FIXTURES, ...DESIGN_GRAPHIC_FIXTURES },
  renderBatch: RENDER_BATCH_FIXTURES,
  imageTakes: IMAGE_TAKES_FIXTURES,
};
