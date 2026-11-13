// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { BrandTypeView } from '../../../../features/brand/brand-view-pages';

/** A brand kit › Type: the fonts for titles and on-screen text. */
export const Route = createFileRoute('/settings/brand/$styleId/type')({
  component: BrandTypeView,
});
