// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Raw provider licence → StockLicence. NC, ND, ShareAlike, Sampling+ and
 * anything else are refused. Search drops them; import refuses again.
 * Pexels is never stored as CC0. A stored row's nc_excluded is always 1.
 */
import { err, ok, type Result, type StockLicence, type StockProviderId } from '@taalcut/core';
import { StockLicenceRefused } from '../errors';

export const LICENCE_TABLE = [
  { provider: 'pexels', raw: 'Pexels-Licence', licence: 'Pexels-Licence' },
  { provider: 'freesound', raw: 'Creative Commons 0', licence: 'CC0-1.0' },
  { provider: 'freesound', raw: 'Attribution', licence: 'CC-BY-4.0' },
] as const satisfies readonly { provider: StockProviderId; raw: string; licence: StockLicence }[];

export function classifyLicence(provider: StockProviderId, raw: string): Result<StockLicence> {
  const row = LICENCE_TABLE.find((entry) => entry.provider === provider && entry.raw === raw);
  return row ? ok(row.licence) : err(StockLicenceRefused({ licence: raw.slice(0, 200) }));
}

/** Freesound's FAQ line for CC-BY. CC0 and the Pexels Licence ask for none (''). */
export function attributionLine(
  licence: StockLicence,
  fields: { readonly title: string; readonly author: string; readonly id: string },
): string {
  if (licence !== 'CC-BY-4.0') return '';
  const line = `"${fields.title}" by ${fields.author} (https://freesound.org/s/${fields.id}/) licensed under CC BY 4.0`;
  return line.slice(0, 500);
}

/** Courtesy only: not required by the Pexels Licence. */
export function pexelsCourtesy(author: string): string {
  return `Video by ${author} on Pexels`.slice(0, 500);
}
