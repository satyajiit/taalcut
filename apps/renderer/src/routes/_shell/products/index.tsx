// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ProductsPage } from '../../../features/products/products-page';
export const Route = createFileRoute('/_shell/products/')({
  staticData: { crumb: msg`Products` },
  component: ProductsPage,
});
