// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProductCampaign, TaalcutError } from '@taalcut/core';

/** Transport/storage retries keep the durable intent; unknown charged model work remains a human retry. */
export function productCampaignFailure(
  campaign: ProductCampaign,
  error: TaalcutError,
  now: number,
): ProductCampaign {
  const attempts = (campaign.attempts ?? 0) + 1;
  const retry = error.retryable && attempts <= 3;
  return {
    ...campaign,
    revision: campaign.revision + 1,
    updatedAt: now,
    attempts,
    status: retry ? 'draft' : 'failed',
    retryAt: retry ? now + 30_000 * 2 ** (attempts - 1) : null,
    lastError: error.code,
  };
}
