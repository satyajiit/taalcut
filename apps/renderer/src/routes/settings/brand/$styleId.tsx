// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, useLocation } from '@tanstack/react-router';
import { BrandKitEditor } from '../../../features/brand/brand-kit-editor';
import { brandViewOf } from '../../../features/brand/brand-kit-views';
import { routeId } from '../../../shell/route-id';

/**
 * One brand kit or look, in the editor (P3-V10): its layout, with each view a child route (colours, type, captions,
 * logo, intro-outro). A malformed id is the not-found page.
 */
export const Route = createFileRoute('/settings/brand/$styleId')({
  params: {
    parse: ({ styleId }) => ({ styleId: routeId<'Style'>(styleId) }),
    stringify: ({ styleId }) => ({ styleId }),
  },
  component: BrandKit,
});

function BrandKit() {
  const { styleId } = Route.useParams();
  const view = brandViewOf(useLocation({ select: (location) => location.pathname }));
  // Keyed by the kit, so another kit's drafts never carry over; the views share one editor.
  return <BrandKitEditor key={styleId} styleId={styleId} view={view} />;
}
