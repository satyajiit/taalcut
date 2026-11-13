// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: stock result tile (P3-V18 in P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one stock video for a gap: its 9:16 poster on the viewer grey (app://media/stock; the grey
 *   stays when it doesn't load or the app has no URL for it), its length and author (provider text, translate="no"), its licence chip, Use it
 * states: default · hover/active/focus-visible (Use it, the kit's Button) · disabled (another result is going in, or
 *   this gap is settled) · loading (Use it spins while the import and the fill run; the row says what it is doing) · error (the
 *   cause under the tile's row, from the caller) · success ("Used", a check, the button gone)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { StockResult } from '@taalcut/core';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { LicenceChip } from './licence-chip';

export type StockTileState = 'idle' | 'using' | 'used';

export interface StockResultTileProps {
  item: StockResult;
  state: StockTileState;
  /** Absent or disabled: no Use it (the gap is settled, or another result is going in). */
  onUse?: () => void;
  disabled?: boolean;
}

export function StockResultTile({ item, state, onUse, disabled = false }: StockResultTileProps) {
  const { t } = useLingui();
  const format = useFormatters();
  const [broken, setBroken] = useState(false);
  const described = useId();
  const length = item.seconds === null ? null : format.duration(item.seconds * 1000);
  const author = item.author.name.trim();
  return (
    <li data-slot="stock-result" data-state={state} className="flex min-w-0 flex-col gap-1.5">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-md bg-viewer">
        {broken || !item.preview ? null : (
          <img
            src={item.preview}
            alt={item.title}
            translate="no"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {length ? <span className="text-xs text-ink tabular-nums">{length}</span> : null}
        {author ? (
          <UserContent id={described} translate="no" className="text-xs break-words text-ink-2">
            {author}
          </UserContent>
        ) : null}
        <LicenceChip licence={item.licence} className="max-w-full whitespace-normal" />
      </div>
      {state === 'used' ? (
        <span role="status" className="flex h-8 items-center gap-1.5 text-sm text-success-strong">
          <Check aria-hidden className="size-4" />
          {t`Used`}
        </span>
      ) : onUse ? (
        <Button
          size="sm"
          className="w-full"
          loading={state === 'using'}
          disabled={disabled && state !== 'using'}
          {...(author ? { 'aria-describedby': described } : {})}
          onClick={onUse}
        >
          {t`Use it`}
        </Button>
      ) : null}
    </li>
  );
}
