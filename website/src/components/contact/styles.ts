// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Class strings the contact page's server and client parts share. A plain module: a constant exported from a
 * 'use client' file reaches a server component as a client reference, never as its value.
 */

/** A link inside a bubble or a row: ink, a rule-strong underline that turns ink on hover, the base focus ring. */
export const INLINE_LINK =
  'rounded-sm font-semibold text-ink underline decoration-rule-strong decoration-1 underline-offset-4 ' +
  'transition-colors duration-(--dur-micro) hover:decoration-ink [overflow-wrap:anywhere]';

/** A sticker field's pastel and its ink, for a chip that wears one (components/ui/sticker's fields). */
export const FIELD_FACES = {
  pink: 'bg-sticker-pink text-sticker-pink-ink',
  teal: 'bg-sticker-teal text-sticker-teal-ink',
  sky: 'bg-sticker-sky text-sticker-sky-ink',
  violet: 'bg-sticker-violet text-sticker-violet-ink',
  lime: 'bg-sticker-lime text-sticker-lime-ink',
  marigold: 'bg-sticker-marigold text-sticker-marigold-ink',
  paper: 'bg-sticker-paper text-sticker-paper-ink',
} as const;
