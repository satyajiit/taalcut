// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { BrandKitsPage } from '../../../features/brand/brand-kits-page';

/** Settings › Brand kits (P3-V10): every brand kit and look; a row opens its editor. */
export const Route = createFileRoute('/settings/brand/')({
  // A crumb: a kit's editor shows "Brand kits ›" (shell/nav).
  staticData: { crumb: msg`Brand kits` },
  component: BrandKitsPage,
});
