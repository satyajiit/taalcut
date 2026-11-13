// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: LookPicker (U8) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the Look menu of the editor's and the template page's window bar: a secondary button naming the look in use,
 *   opening a radio menu of None, the brand kits and the looks (each a StyleChip), then "Manage brand kits…"
 * states: default · hover/active/focus-visible (Button's own) · open (the menu, arrow keys and type-ahead) ·
 *   loading (no list yet: the button is busy, the menu waits) · disabled (read-only: an older template version) ·
 *   busy (a change is being saved: the button spins, keeps focus) · error (the change failed: the button turns
 *   danger until the next pick) · success (the new name shows) · missing (the look in use was deleted: "Missing
 *   look") · empty (no kits yet: None and Manage only) · compact (a crowded window bar: under 1440 px the icon and
 *   the chevron, the words in a tooltip and to screen readers)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { StyleId, StyleSummary } from '@taalcut/core';
import { ChevronDown, Palette } from 'lucide-react';
import { Button } from '#components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/dropdown-menu';
import { UserContent } from '../cards/card-frame';
import { StyleChip } from './style-chip';

const NONE = 'none';

export interface LookPickerProps {
  /** Every brand kit and look (styles.list); undefined while loading. */
  readonly styles: readonly StyleSummary[] | undefined;
  /** The look in use; null: none. */
  readonly value: StyleId | null;
  readonly onChange: (styleId: StyleId | null) => void;
  /** "Manage brand kits…" (Settings › Brand kits); hidden when absent. */
  readonly onManage?: () => void;
  /** A logo's URL the page can load; absent: every chip shows its swatch. */
  readonly logoUrl?: (style: StyleSummary) => string | null;
  readonly disabled?: boolean;
  /** A change is being saved. */
  readonly busy?: boolean;
  /** The last change failed. */
  readonly failed?: boolean;
  /** Under 1440 px: the icon and the chevron, the words in a tooltip (a window bar that also has the GitHub links). */
  readonly compact?: boolean;
}

export function LookPicker({
  styles,
  value,
  onChange,
  onManage,
  logoUrl,
  disabled = false,
  busy = false,
  failed = false,
  compact = false,
}: LookPickerProps) {
  const { t } = useLingui();
  const current = value === null ? null : styles?.find((style) => style.id === value);
  const currentName = current?.name;
  const kits = styles?.filter((style) => style.kind === 'brandKit') ?? [];
  const looks = styles?.filter((style) => style.kind === 'look') ?? [];
  const item = (style: StyleSummary) => (
    <DropdownMenuRadioItem key={style.id} value={style.id}>
      <StyleChip
        size="sm"
        name={style.name}
        colours={style.colours}
        logoUrl={logoUrl?.(style) ?? null}
        kind="brandKit"
        isDefault={style.isDefault}
      />
    </DropdownMenuRadioItem>
  );
  const words =
    value === null ? (
      t`Look: None`
    ) : currentName !== undefined ? (
      <Trans>
        Look: <UserContent>{currentName}</UserContent>
      </Trans>
    ) : styles === undefined ? (
      t`Look`
    ) : (
      t`Look: Missing look`
    );
  const trigger = (
    <DropdownMenuTrigger asChild disabled={disabled}>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        loading={busy || styles === undefined}
        status={failed ? 'error' : undefined}
        data-slot="look-picker"
      >
        {busy || styles === undefined ? null : <Palette aria-hidden />}
        <span
          className={
            compact
              ? 'sr-only min-[1440px]:not-sr-only min-[1440px]:max-w-[14rem] min-[1440px]:truncate'
              : 'max-w-[14rem] truncate'
          }
        >
          {words}
        </span>
        <ChevronDown aria-hidden />
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent className="min-[1440px]:hidden">{words}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuRadioGroup
          value={value ?? NONE}
          onValueChange={(next) => {
            const picked = next === NONE ? null : styles?.find((style) => style.id === next)?.id;
            if (picked !== undefined && picked !== value) onChange(picked);
          }}
        >
          <DropdownMenuRadioItem value={NONE}>{t`None`}</DropdownMenuRadioItem>
          {kits.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t`Brand kits`}</DropdownMenuLabel>
              {kits.map(item)}
            </>
          ) : null}
          {looks.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t`Looks`}</DropdownMenuLabel>
              {looks.map(item)}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
        {onManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManage}>{t`Manage brand kits…`}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
