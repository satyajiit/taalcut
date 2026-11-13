// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, defineError, type ProductCampaign } from '@taalcut/core';
import { expect, it } from 'vitest';
import { productCampaignFailure } from '../../src/products';

const transient = defineError('agent.product_test_transient', { retryable: true });
const permanent = defineError('agent.product_test_permanent', { retryable: false });
const campaign: ProductCampaign = {
  id: newId<'ProductCampaign'>(),
  productId: newId<'Product'>(),
  ideaId: newId<'ProductIdea'>(),
  projectId: newId<'Project'>(),
  conversationId: null,
  revision: 1,
  status: 'draft',
  createdAt: 1,
  updatedAt: 1,
};

it('persists bounded exponential backoff without losing campaign intent', () => {
  const first = productCampaignFailure(campaign, transient(), 1000);
  expect(first).toMatchObject({ status: 'draft', retryAt: 31000, attempts: 1, revision: 2 });
  const second = productCampaignFailure(first, transient(), 31000);
  expect(second.retryAt).toBe(91000);
  const third = productCampaignFailure(second, transient(), 91000);
  expect(third.retryAt).toBe(211000);
  expect(productCampaignFailure(third, transient(), 211000)).toMatchObject({
    status: 'failed',
    retryAt: null,
    attempts: 4,
  });
  expect(productCampaignFailure(campaign, permanent(), 1)).toMatchObject({ status: 'failed', retryAt: null });
});
