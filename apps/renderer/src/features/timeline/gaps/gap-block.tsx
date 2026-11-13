// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap block (P3-B8) · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * an empty slot on the bed, as long as the slot: the label strip says "Empty" (the bed numbers clips, so a gap
 *   carries its slot number in its name and its popover), then "Fix this gap" (the wrench alone when narrow) on the
 *   sunken surface (solid hairline: an empty slot, not a dashed drop box); an option of the clips' listbox,
 *   so arrows reach it like a clip; Return or Space (or a click) opens the gap's fixes in a popover anchored to it
 * states: default · hover (the hover surface) · focus-visible (the base ring, on the roving stop) · active (pressed
 *   surface) · open (the selection wash while its popover is open) · disabled/loading/error/success: the popover's
 *   (a fix that went through turns the gap into a clip or removes it, and the popover goes with it)
 * motion: none of its own; the popover opens at once (DESIGN.md)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { cn, GapFixPopover } from '@taalcut/ui';
import { Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useEditorContext } from '../editor-context';
import type { PositionView } from '../model';
import { GapFixPanel } from './gap-fix-panel';

export interface GapBlockProps {
  readonly position: PositionView;
  /** Its width on the bed, in pixels. */
  readonly width: number;
  readonly ref?: Ref<HTMLDivElement>;
  /** The roving tab stop of the clip list. */
  readonly tabStop?: boolean;
  /** Arrows, Home and End: the bed moves focus (the same keys as on a clip). */
  readonly onNavigate?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** A fix went through: the bed puts focus on what is there now. */
  readonly onSettled?: (outcome: 'filled' | 'dropped' | 'asked') => void;
}

/** P3-B8: an empty slot on the bed (a gap), with "Fix this gap". */
export function GapBlock({ position, width, ref, tabStop = false, onNavigate, onSettled }: GapBlockProps) {
  const { t, i18n } = useLingui();
  const editor = useEditorContext();
  const [open, setOpen] = useState(false);
  const block = useRef<HTMLDivElement | null>(null);
  const n = i18n.number(position.index + 1);
  const narrow = width < 100;
  const firstGap =
    editor?.model.positions.find((entry) => entry.item.type === 'gap')?.item.id === position.item.id;
  const panel = editor?.panel;
  const onPanel = editor?.onPanel;

  // ?panel=gaps (a card's "Fix the gaps"): the first gap opens, in view.
  useEffect(() => {
    if (panel !== 'gaps' || !firstGap) return;
    setOpen(true);
    block.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [panel, firstGap]);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next && panel === 'gaps') onPanel?.(undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      change(true);
      return;
    }
    onNavigate?.(event);
  };
  const setRef = (el: HTMLDivElement | null) => {
    block.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const anchor = (
    <div
      ref={setRef}
      role="option"
      aria-selected={false}
      aria-label={t`Shot ${n} is empty: fix this gap`}
      tabIndex={tabStop ? 0 : -1}
      data-slot="timeline-gap"
      data-gap-id={position.item.id}
      data-flip-key={position.item.id}
      data-open={open || undefined}
      className={cn(
        'group/gap relative flex h-full shrink-0 cursor-pointer flex-col overflow-hidden rounded-clip border border-rule bg-sunken select-none',
        'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:bg-pressed',
        open && 'bg-selected hover:bg-selected',
      )}
      style={{ width }}
      onClick={() => change(!open)}
      onKeyDown={onKeyDown}
    >
      <div className="flex h-4 items-center gap-1 px-1.5 text-2xs leading-none font-medium whitespace-nowrap text-ink-2">
        <span className="min-w-0 truncate">{t`Empty`}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-1 px-1 text-xs font-medium text-ink-2 group-hover/gap:text-ink">
        <Wrench aria-hidden className="size-3.5 shrink-0" />
        {narrow ? null : <span className="truncate">{t`Fix this gap`}</span>}
      </div>
    </div>
  );

  if (!editor) return anchor;
  return (
    <GapFixPopover
      open={open}
      onOpenChange={change}
      label={t`Fix shot ${n}`}
      anchor={anchor}
      onClosed={() => block.current?.focus()}
      isAnchor={(target) => target instanceof Node && !!block.current?.contains(target)}
    >
      {open ? (
        <GapFixPanel
          projectId={editor.projectId}
          timeline={editor.timeline}
          gapId={position.item.id}
          total={editor.model.total}
          onDone={(outcome) => {
            setOpen(false);
            if (panel === 'gaps') onPanel?.(undefined);
            onSettled?.(outcome);
          }}
        />
      ) : null}
    </GapFixPopover>
  );
}
