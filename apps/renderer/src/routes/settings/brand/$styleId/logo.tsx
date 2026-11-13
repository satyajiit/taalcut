// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { BrandLogoView } from '../../../../features/brand/brand-view-pages';

/** A brand kit › Logo: the logo and the watermark. */
export const Route = createFileRoute('/settings/brand/$styleId/logo')({
  component: BrandLogoView,
});
