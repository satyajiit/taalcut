// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-B8: the gap fixes' words: each fix's name, why one isn't offered, a stock licence, an error's reason. */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { BundledLicence, GapFixKind, StockLicence, TaalcutError } from '@taalcut/core';
import type { GapFixReason } from './gap-types';

export const FIX_TITLES: Readonly<Record<GapFixKind, MessageDescriptor>> = {
  film: msg`Film this`,
  generate: msg`Generate an image`,
  stock: msg`Stock video`,
  drop: msg`Drop this shot`,
  swap: msg`Use this clip instead`,
  keep: msg`Keep this clip`,
  addClips: msg`Add more clips`,
  borrow: msg`Use the clip from another shot`,
  reuse: msg`Use another part of a clip`,
};

/** One line per fix that isn't offered: the fix and what stands in its way. */
const REASONS: Readonly<Partial<Record<`${GapFixKind}.${GapFixReason}`, MessageDescriptor>>> = {
  'stock.noStockKey': msg`Stock video needs your Pexels key in Settings → Accounts.`,
  'stock.stockOff': msg`Stock video isn’t available yet.`,
  'stock.localOnly': msg`Stock video needs the internet, and Local only is on.`,
  'stock.budgetCap': msg`Stock video would go over this project’s budget cap.`,
  'generate.localOnly': msg`Generating an image needs the internet, and Local only is on.`,
  'generate.budgetCap': msg`Generating an image would go over this project’s budget cap.`,
  'generate.noImageModel': msg`Generating an image needs an image model in Settings → Models.`,
};

const FALLBACK_REASONS: Readonly<Record<GapFixReason, MessageDescriptor>> = {
  localOnly: msg`Local only is on.`,
  noStockKey: msg`It needs your Pexels key in Settings → Accounts.`,
  stockOff: msg`It isn’t available yet.`,
  budgetCap: msg`It would go over this project’s budget cap.`,
  noImageModel: msg`It needs an image model in Settings → Models.`,
};

export function reasonWords(kind: GapFixKind, reason: GapFixReason): MessageDescriptor {
  return REASONS[`${kind}.${reason}`] ?? FALLBACK_REASONS[reason];
}

/** The settings page that clears a reason, when there is one. */
export const REASON_SETTINGS: Readonly<
  Partial<Record<GapFixReason, 'accounts' | 'models' | 'privacy' | 'usage'>>
> = {
  noStockKey: 'accounts',
  noImageModel: 'models',
  localOnly: 'privacy',
  budgetCap: 'usage',
};

/** A stock item's licence, or a bundled sound's (D22): MIT is a sound Taalcut's build rendered from code. */
export type ChipLicence = StockLicence | BundledLicence;

export const LICENCE_LABELS: Readonly<Record<ChipLicence, MessageDescriptor>> = {
  'Pexels-Licence': msg`Pexels licence`,
  'CC0-1.0': msg`CC0`,
  'CC-BY-4.0': msg`CC BY: credit needed`,
  MIT: msg({
    message: 'Code-made',
    comment: 'A sound effect made by code, not recorded (MIT licence). A short chip label.',
  }),
};

/** A stock search that refused says why the way the card's reasons do (library's stock service, core). */
export function reasonOfError(error: TaalcutError): GapFixReason | null {
  if (error.code === 'core.local_only') return 'localOnly';
  if (error.code === 'library.stock_no_key') return 'noStockKey';
  if (error.code === 'library.stock_unavailable') return 'stockOff';
  return null;
}
