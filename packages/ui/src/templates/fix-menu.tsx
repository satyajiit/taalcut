// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the review's Fix menu (BRK1-REV) · system: DESIGN.md v0.7 (menus pop from their
 *   trigger on the overlay surface)
 * the direct fixes for the slot on screen, each one command, each undoable: add a cut at the playhead, move the cut
 *   (to the strip's grip, the keyboard's way), not a cut, rename it, check it again, drop it, its part in the reel, and the
 *   reel's tempo halved or doubled. What can't apply here is there but off (the first slot has no cut before it)
 * states: the menu's (dropdown-menu.tsx): closed · open · an item's hover, focus and disabled · the trigger's
 *   loading while a fix from it is on its way
 */
import { useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '#components/button';
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
import { ROLE_KIND } from './kinds';
import { REVIEW_ICONS } from './review-icons';
import { ROLE_LABELS } from './slot-words';

type Role = Template['slots'][number]['role'];
const ROLES: readonly Role[] = ['hook', 'body', 'peak', 'outro'];

export interface FixMenuProps {
  template: Template;
  index: number;
  busy: boolean;
  /** Whether the playhead is inside this slot, a frame clear of its edges: a cut can go there. Asked on opening. */
  canCutAtPlayhead: () => boolean;
  /** The playhead's time in seconds, named in "Add a cut at 4.75s". */
  playhead: () => number;
  /** The menu opened: the reel pauses, so the playhead the menu names stays where it is. */
  onOpen?: () => void;
  onAddCut: () => void;
  onMoveCut: () => void;
  onNotCut: () => void;
  onDrop: () => void;
  onRename: () => void;
  /** An approved slot back to the ones to check (template.slot.approve, approved: false). */
  onUnapprove: () => void;
  onRole: (role: Role) => void;
  onTempo: (factor: 0.5 | 2) => void;
}

export function FixMenu({
  template,
  index,
  busy,
  canCutAtPlayhead,
  playhead,
  onOpen,
  onAddCut,
  onMoveCut,
  onNotCut,
  onDrop,
  onRename,
  onUnapprove,
  onRole,
  onTempo,
}: FixMenuProps) {
  const { t, i18n } = useLingui();
  const slot = template.slots[index]!;
  const first = index === 0;
  const number = i18n.number(index + 1);
  const [cuttable, setCuttable] = useState(false);
  const [cutAt, setCutAt] = useState(0);
  const at = i18n.number(cutAt, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: 2,
  });
  // Move the cut and Rename hand focus on (to the cut's handle, to the name field) once the menu has closed; else
  // the menu gives it back to Fix and the arrows would move between slots instead.
  const handOff = useRef<(() => void) | null>(null);
  // In the sheet the menu stays inside it, above Fix (the actions sit at the panel's foot), flipping when it must.
  const trigger = useRef<HTMLButtonElement>(null);
  const [boundary, setBoundary] = useState<Element | null>(null);
  const thenFocus = (action: () => void) => () => {
    handOff.current = action;
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return;
        setBoundary(trigger.current?.closest('[role=dialog]') ?? null);
        onOpen?.();
        setCuttable(canCutAtPlayhead());
        setCutAt(playhead());
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          data-slot="fix"
          size="sm"
          variant="secondary"
          icon={ChevronDown}
          iconPlacement="end"
          loading={busy}
        >
          {t`Fix`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        collisionPadding={8}
        collisionBoundary={boundary}
        className="min-w-60"
        onCloseAutoFocus={(event) => {
          const action = handOff.current;
          if (!action) return;
          handOff.current = null;
          event.preventDefault();
          action();
        }}
      >
        <DropdownMenuLabel>{t`The cuts`}</DropdownMenuLabel>
        <DropdownMenuItem disabled={!cuttable} onSelect={onAddCut}>
          <REVIEW_ICONS.addCut aria-hidden />
          {cuttable ? t`Add a cut at ${at}` : t`Add a cut at the playhead`}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={thenFocus(onMoveCut)}>
          <REVIEW_ICONS.moveCut aria-hidden />
          {t`Move the cut before slot ${number}`}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={onNotCut}>
          <REVIEW_ICONS.notCut aria-hidden />
          {t`Not a cut: join slot ${number} to the one before`}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t`This slot`}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={thenFocus(onRename)}>
          <REVIEW_ICONS.rename aria-hidden />
          {t`Rename`}
        </DropdownMenuItem>
        {slot.approved ? (
          <DropdownMenuItem onSelect={onUnapprove}>
            <REVIEW_ICONS.checkAgain aria-hidden />
            {t`Check slot ${number} again`}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={template.slots.length < 2} onSelect={onDrop}>
          <REVIEW_ICONS.drop aria-hidden />
          {t`Drop slot ${number}`}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t`Its part in the reel`}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={slot.role} onValueChange={(value) => onRole(value as Role)}>
          {ROLES.map((role) => {
            const Icon = ROLE_KIND[role].icon;
            return (
              <DropdownMenuRadioItem key={role} value={role}>
                <Icon aria-hidden />
                {i18n._(ROLE_LABELS[role])}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        {template.beatMap ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t`The beat`}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onTempo(0.5)}>
              <REVIEW_ICONS.tempo aria-hidden />
              {t`Half as many beats`}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTempo(2)}>
              <REVIEW_ICONS.tempo aria-hidden />
              {t`Twice as many beats`}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
