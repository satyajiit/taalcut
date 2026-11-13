// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { StockScenario } from '../../../phase3/fake-stock';

const STOCK: readonly StockScenario[] = ['ready', 'noKey', 'off', 'localOnly', 'failing'];

/**
 * The gaps area's scenario (P3-B8): `punch: 'golden'` turns Golden hour market's second video's slots 3 and 7
 * into gaps at start; `stock` is how the stock service answers ('ready', 'noKey', 'off', 'localOnly', 'failing').
 */
export interface GapsArea {
  readonly punch?: 'golden';
  readonly stock?: StockScenario;
}

/** The area's options from whatever the store held: unknown keys and values are left out. */
export function readGapsArea(value: unknown): GapsArea {
  if (!value || typeof value !== 'object') return {};
  const o = value as Record<string, unknown>;
  const stock = STOCK.find((scenario) => scenario === o['stock']);
  return { ...(o['punch'] === 'golden' ? { punch: 'golden' } : {}), ...(stock ? { stock } : {}) };
}
