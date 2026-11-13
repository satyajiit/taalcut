// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a chip's name in a line of text · genre: atmospheric studio app · system: DESIGN.md v0.6 (UX3)
 * the maker's chip mark (16 px, its colour) before the name, set in the text's own line; the maker's name in words
 *   too, before the chip's own when that doesn't already say it ("Qualcomm Snapdragon X Elite"), so the colour is
 *   never the only sign. Settings › About's Processor and Graphics.
 * states: n/a (static text)
 */
import type { ReactNode } from 'react';
import { ChipMark } from './chip-mark';
import { vendorNotNamed, type ChipVendor } from './chip-vendor';

export function ChipName({
  name,
  vendor,
  children,
}: {
  name: string;
  vendor: ChipVendor;
  children: ReactNode;
}) {
  const maker = vendorNotNamed(name, vendor);
  return (
    <span data-slot="chip-name" data-vendor={vendor}>
      <ChipMark vendor={vendor} className="me-1.5 inline-block size-4 align-[-0.2em]" />
      {maker ? (
        <>
          <span translate="no">{maker}</span>{' '}
        </>
      ) : null}
      {children}
    </span>
  );
}
