// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardActions } from '@taalcut/ui';
import type { Backend } from '../../../backend/backend';
import { fillGapWithStock } from './stock-use';

/** P3-B8, P3-V18: use a stock result for a gap (library.importStock, its job, then timeline.fillGap). */
export function stockCardActions(backend: Backend): Pick<CardActions, 'stock'> {
  return { stock: { use: (input) => fillGapWithStock(backend, input) } };
}
