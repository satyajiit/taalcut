// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a slot's camera move, measured from the reel, and the person's pick (FRM1-MOT) ·
 *   system: DESIGN.md v0.7 (violet: the AI's reading; teal: yours; menus pop from their trigger on the overlay surface)
 * what the camera does in the shot. Taalcut measures it; the trigger names the move, led by the AI mark when it is
 *   Taalcut's reading and "You" when the person picked another, and opens a menu: what was measured in one line, then
 *   the seven moves, each with what it means, and "I don't know". Picking one is template.setMotion, undoable. As a
 *   doubt's answer the trigger says "Pick the camera move"
 * states: default · hover · focus · open (the menu, the current move ticked) · disabled (another fix on its way) ·
 *   loading (this pick on its way: the trigger spins) · error (the panel's line) · read-only (a chip, no menu)
 * contrast: the trigger is the secondary or ghost button (ink on control, 4.5:1 in both themes); a move's line is
 *   ink-2 on overlay (4.5:1)
 * reduced motion: the menu's pop is a fade (dropdown-menu.tsx); nothing else moves
 */
import { useLingui } from '@lingui/react/macro';
import type { CameraMotion, Template } from '@taalcut/core';
import { ChevronDown } from 'lucide-react';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/dropdown-menu';
import { REVIEW_ICONS } from './review-icons';
import { MOTION_HINTS, MOTION_LABELS } from './slot-words';

type Slot = Template['slots'][number];

/** The moves in the order a person thinks of them: still first, then turns, then moving closer or away, then hands. */
export const CAMERA_MOVES: readonly CameraMotion[] = [
  'static',
  'pan',
  'tilt',
  'push-in',
  'pull-out',
  'handheld',
  'tracking',
];
const UNKNOWN = 'unknown';

/** Whose the slot's move is: Taalcut's reading (measured, or written before FRM1) or the person's pick. */
export function motionAuthor(slot: Slot): 'ai' | 'you' {
  if (slot.motionMeasure) return slot.motionMeasure.label === slot.intent.motion ? 'ai' : 'you';
  return slot.intent.source === 'user' ? 'you' : 'ai';
}

export interface CameraMoveProps {
  slot: Slot;
  /** The slot's number as the panel shows it. */
  number: string;
  /** This pick is on its way. */
  busy: boolean;
  /** Another fix is on its way. */
  disabled?: boolean;
  /** "answer": a doubt's answer ("Pick the camera move"); "value": the move itself, beside the description. */
  variant?: 'value' | 'answer';
  /** Picks a move; null is "I don't know". Undefined: read-only. */
  onPick?: ((motion: CameraMotion | null) => void) | undefined;
}

export function CameraMove({
  slot,
  number,
  busy,
  disabled = false,
  variant = 'value',
  onPick,
}: CameraMoveProps) {
  const { t, i18n } = useLingui();
  const motion = slot.intent.motion;
  const author = motionAuthor(slot);
  const name = motion ? i18n._(MOTION_LABELS[motion]) : t`Not known`;
  const lead =
    motion === null ? null : author === 'you' ? (
      <Chip tone="you">{t`You`}</Chip>
    ) : (
      <AiMark className="size-3.5 shrink-0" label={t`Taalcut’s reading`} />
    );

  if (!onPick)
    return motion ? (
      <Chip data-slot="camera-move">
        <REVIEW_ICONS.cameraMove aria-hidden />
        {name}
      </Chip>
    ) : null;

  const measure = slot.motionMeasure;
  const measured = measure?.label ? i18n._(MOTION_LABELS[measure.label]) : null;
  let reading: string | null = null;
  if (measure && !measured) reading = t`Taalcut couldn’t measure it from the reel`;
  else if (measure && motion === null) reading = t`Taalcut measured ${measured}, but isn’t sure`;
  else if (measure && measure.label === motion) reading = t`Taalcut measured ${measured} from the reel`;
  else if (measure) reading = t`Taalcut measured ${measured}; you picked another`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'answer' ? (
          <Button
            data-slot="camera-move-answer"
            size="sm"
            variant="secondary"
            icon={REVIEW_ICONS.cameraMove}
            loading={busy}
            disabled={disabled && !busy}
          >
            {t`Pick the camera move`}
          </Button>
        ) : (
          <Button
            data-slot="camera-move"
            size="sm"
            variant="ghost"
            icon={ChevronDown}
            iconPlacement="end"
            loading={busy}
            disabled={disabled && !busy}
            aria-label={t`Camera move in slot ${number}: ${name}. Change it`}
          >
            <span className="flex items-center gap-1.5">
              <REVIEW_ICONS.cameraMove aria-hidden className="size-3.5 shrink-0 text-ink-3" />
              {lead}
              <span className={motion ? 'text-ink' : 'text-ink-2'}>{name}</span>
            </span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8} className="w-72">
        <DropdownMenuLabel>{t`How the camera moves in slot ${number}`}</DropdownMenuLabel>
        {reading ? (
          <p
            data-slot="camera-move-reading"
            className="m-0 flex items-start gap-1.5 px-2 pb-1.5 type-meta text-ink-2"
          >
            {/* Inside a menu only items may be named; the line itself says it is Taalcut's. */}
            <AiMark className="mt-0.5 size-3.5 shrink-0" />
            {reading}
          </p>
        ) : null}
        <DropdownMenuRadioGroup
          value={motion ?? UNKNOWN}
          onValueChange={(value) => onPick(value === UNKNOWN ? null : (value as CameraMotion))}
        >
          {CAMERA_MOVES.map((move) => (
            <DropdownMenuRadioItem key={move} value={move} className="items-start">
              <span className="flex min-w-0 flex-col">
                <span>{i18n._(MOTION_LABELS[move])}</span>
                <span className="type-meta text-ink-2">{i18n._(MOTION_HINTS[move])}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={UNKNOWN} className="items-start">
            <span className="flex min-w-0 flex-col">
              <span>{t`I don’t know`}</span>
              <span className="type-meta text-ink-2">{t`Your clips can move any way here`}</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
