// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The default list is Pexels only. Freesound joins when `stock.freesound` is on. */
import type { StockProvider } from '../stock-provider';
import { freesoundProvider } from './freesound';
import { pexelsProvider } from './pexels';

export function defaultStockProviders(flags: { readonly freesound: boolean }): readonly StockProvider[] {
  return flags.freesound ? [pexelsProvider, freesoundProvider] : [pexelsProvider];
}
