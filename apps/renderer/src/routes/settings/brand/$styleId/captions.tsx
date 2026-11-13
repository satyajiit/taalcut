// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { BrandCaptionsView } from '../../../../features/brand/brand-view-pages';

/** A brand kit › Captions: how spoken words look. */
export const Route = createFileRoute('/settings/brand/$styleId/captions')({
  component: BrandCaptionsView,
});
