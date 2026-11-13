// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import type { ProductNotification } from '@taalcut/core';

export const PRODUCT_ACTIVITY_WORDS = {
  'ideas-ready': msg`New video ideas are ready`,
  'no-fresh-ideas': msg`No strong new idea this time`,
  'draft-ready': msg`Your video is ready to review`,
  'approval-required': msg`Your input is needed`,
  published: msg`Post published`,
  failed: msg`A task needs attention`,
} satisfies Record<ProductNotification['kind'], ReturnType<typeof msg>>;
