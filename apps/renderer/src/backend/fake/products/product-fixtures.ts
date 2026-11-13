// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- authored fixture content, not application UI */

import { productSchema, type Product } from '@taalcut/core';
import { fakeUlid } from '../library/seed';

export const PRODUCT_DEMO = fakeUlid<'Product'>(30, 1);

/** A hidden, addressable workspace for the route and accessibility checks. */
export function productDemo(): Product {
  return productSchema.parse({
    id: PRODUCT_DEMO,
    name: 'OpenAlly',
    description: 'A workspace that answers the next question.',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  });
}
