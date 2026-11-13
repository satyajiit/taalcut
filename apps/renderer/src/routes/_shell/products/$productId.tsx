// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { parseId } from '@taalcut/core';
import { createFileRoute } from '@tanstack/react-router';
import {
  PRODUCT_VIEWS,
  ProductWorkspace,
  type ProductView,
} from '../../../features/products/product-workspace';
import { NotFound } from '../../../shell/not-found';
export const Route = createFileRoute('/_shell/products/$productId')({
  validateSearch: (search: Record<string, unknown>): { view?: ProductView } => ({
    view: PRODUCT_VIEWS.includes(search.view as ProductView) ? (search.view as ProductView) : 'ideas',
  }),
  component: ProductRoute,
});
function ProductRoute() {
  const id = parseId<'Product'>(Route.useParams().productId);
  const navigate = Route.useNavigate();
  const { view } = Route.useSearch();
  if (!id.ok) return <NotFound />;
  return (
    <ProductWorkspace
      productId={id.value}
      view={view ?? 'ideas'}
      onView={(next) => void navigate({ search: { view: next } })}
    />
  );
}
