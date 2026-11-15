// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a More sheet (MORE1) · system: DESIGN.md v0.7 (Footage First)
 * the surface for a change judged by eye (speed, the transition, colour): it takes the tiles' place in the lower
 *   panel and never covers the viewer, so the picture above keeps showing what each choice does. Back, the
 *   action's chip and name, its value now in words, then the choices
 * keys: Escape and Back return to the tiles with focus on the tile that opened it; that Escape is not also the
 *   editor's deselect. Opening puts focus on the choice in use
 * states: open · a change on its way (the choice spins, the rest wait) · refused (the command's own cause in a
 *   line under the choices, role="alert", and not a second time under the transport) · the value read out when a
 *   change lands (role="status")
 * motion: it arrives with the kit's rise and fade (220 ms); reduced motion: the fade alone
 */
import { useLingui } from '@lingui/react/macro';
import type { Result, TaalcutError } from '@taalcut/core';
import {
  Arrival,
  Button,
  CONCEPT_ICONS,
  errorMessage,
  Glyph,
  VERB_ICONS,
  type IconComponent,
} from '@taalcut/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Edits } from '../use-edits';
import { TileChip, type TileFamily } from './more-tile';

/** How long a choice just sent keeps its mark when the timeline's new revision is slow to arrive. */
const HOLD_MS = 600;

export interface SheetSend {
  /** The choice an edit on its way will set. */
  readonly sending: string | null;
  /** Why the last edit was refused. */
  readonly refusal: TaalcutError | null;
  run(key: string, action: () => Promise<Result<unknown>>): Promise<Result<unknown>>;
}

/**
 * One edit at a time from a More surface. `current` is the value on show: once the timeline brings the new one,
 * the choice stops waiting. A refusal is kept for the surface to say, and cleared from under the transport.
 */
export function useSheetSend(edits: Edits, current: string): SheetSend {
  const [sending, setSending] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<TaalcutError | null>(null);
  const alive = useRef(true);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
  // The timeline's next revision is the answer.
  useEffect(() => setSending(null), [current]);
  return {
    sending,
    refusal,
    async run(key, action) {
      setRefusal(null);
      setSending(key);
      const result = await action();
      if (!alive.current) return result;
      if (!result.ok) {
        // Said beside the control, in the command's own words: not a second time under the transport.
        edits.clearError();
        setRefusal(result.error);
        setSending(null);
      } else {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setSending(null), HOLD_MS);
      }
      return result;
    },
  };
}

/** What a surface says under its controls: why the last change was refused, else its one line of help. */
export function SheetNote({
  id,
  refusal,
  children,
}: {
  id?: string;
  refusal: TaalcutError | null;
  children?: ReactNode;
}) {
  const { i18n } = useLingui();
  if (refusal)
    return (
      <p
        id={id}
        role="alert"
        data-slot="more-refusal"
        className="m-0 flex items-start gap-1.5 type-meta text-ink"
      >
        <Glyph icon={CONCEPT_ICONS.error} size="sm" className="mt-px text-danger-strong" />
        {errorMessage(i18n, refusal)}
      </p>
    );
  return children ? (
    <p id={id} className="m-0 type-meta text-ink-2">
      {children}
    </p>
  ) : null;
}

export interface MoreSheetProps {
  /** Which action it is (`data-sheet`). */
  id: string;
  family: TileFamily;
  icon?: IconComponent;
  /** The value drawn in the chip, in the glyph's place. */
  picture?: ReactNode;
  title: string;
  /** The value now, in words: read out when it changes. */
  value: string;
  /** The sheet's own action, at the end of its title line (the colour sheet's way back to as shot). */
  action?: ReactNode;
  onClose(): void;
  children: ReactNode;
}

export function MoreSheet({
  id,
  family,
  icon,
  picture,
  title,
  value,
  action,
  onClose,
  children,
}: MoreSheetProps) {
  const { t } = useLingui();
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  // Focus goes to the choice in use, so the arrows start from it; Back when there is none.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      '[role=radio][aria-checked=true], [role=radio][tabindex="0"]',
    );
    (first ?? ref.current?.querySelector<HTMLElement>('[data-slot=more-sheet-back]'))?.focus();
  }, []);
  return (
    <section
      ref={ref}
      data-slot="more-sheet"
      data-sheet={id}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // Ours: the editor's Escape would also let go of the scene.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <Arrival animate className="flex min-w-0 flex-col gap-3">
        <header className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
          <Button
            size="sm"
            variant="ghost"
            data-slot="more-sheet-back"
            className="-ms-1.5"
            icon={VERB_ICONS.back}
            onClick={onClose}
          >
            {t`Back`}
          </Button>
          <TileChip family={family} icon={icon}>
            {picture}
          </TileChip>
          <div className="flex min-w-24 flex-1 flex-col">
            <h2 id={titleId} className="m-0 type-card-title text-ink">
              {title}
            </h2>
            <p role="status" data-slot="more-sheet-value" className="m-0 type-meta break-words text-ink-2">
              {value}
            </p>
          </div>
          {action}
        </header>
        {children}
      </Arrival>
    </section>
  );
}
