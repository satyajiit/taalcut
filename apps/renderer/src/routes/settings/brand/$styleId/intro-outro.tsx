// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { BrandBumpersView } from '../../../../features/brand/brand-view-pages';

/** A brand kit › Intro and outro: what plays before and after every video. */
export const Route = createFileRoute('/settings/brand/$styleId/intro-outro')({
  component: BrandBumpersView,
});
