// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { BrandColoursView } from '../../../../features/brand/brand-view-pages';

/** A brand kit › Colours: the kit's five colours. */
export const Route = createFileRoute('/settings/brand/$styleId/colours')({
  component: BrandColoursView,
});
