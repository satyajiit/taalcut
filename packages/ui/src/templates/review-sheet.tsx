// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the review sheet over the chat (BRK1-REV) · system: DESIGN.md v0.7 (dialogs:
 *   the overlay surface, 2xl radius, the lg shadow, over a scrim)
 * "Review the reel" from the breakdown card opens the review as a large sheet, a 16 px margin from the window's
 *   edges, so the chat and its run go on underneath; Done (or Escape) closes it and the card shows what changed.
 *   Its bar names the template (a person's words, marked as theirs) and holds Done; under it, the review
 * states: opening (the dialog's pop) · loading (the template's last version stays while the next one arrives) ·
 *   the review's own · gone (the template was deleted: one line and Done)
 * motion: the dialog's pop over a fading scrim; reduced motion: the fades alone
 */
import { useLingui } from '@lingui/react/macro';
import type {
  ProjectId,
  Result,
  Template,
  TemplateProposals,
  TemplateProposeEditsInput,
} from '@taalcut/core';
import { useLayoutEffect, useRef } from 'react';
import { Button } from '#components/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '#components/dialog';
import { UserContent } from '../cards/card-frame';
import { REVIEW_ICONS } from './review-icons';
import { TemplateReview } from './template-review';

export interface ReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template's name in the library: the person's words. */
  name: string | null;
  template: Template | null;
  reelUrl: string | null;
  sheetUrl: string | null;
  projectId: ProjectId | null;
  dispatch?: ((name: string, payload: unknown) => Promise<Result<unknown>>) | undefined;
  undo?: (() => Promise<Result<unknown>>) | undefined;
  propose?: ((input: TemplateProposeEditsInput) => Promise<Result<TemplateProposals>>) | undefined;
}

export function ReviewSheet({
  open,
  onOpenChange,
  name,
  template,
  reelUrl,
  sheetUrl,
  projectId,
  dispatch,
  undo,
  propose,
}: ReviewSheetProps) {
  const { t } = useLingui();
  // What had focus when it opened (Review the reel): focus goes back there when it closes (WCAG 2.4.3). The kit's
  // dialog remembers its opener on mount, and this one stays mounted closed.
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        ref={content}
        // It opens on the selected slot in the strip, not on Done: Space plays the reel there, the arrows move between
        // slots, and Tab goes on to the rest. On Done, the first Space would have closed it.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() =>
            content.current
              ?.querySelector<HTMLElement>('[data-slot=slot-strip] [aria-selected=true]')
              ?.focus({ preventScroll: true }),
          );
        }}
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus();
        }}
        // Escape inside an edit belongs to the edit: a description or a name being typed, a cut being moved from the
        // keyboard, the sound's credit. It cancels that; the next Escape closes the sheet.
        onEscapeKeyDown={(event) => {
          const at = document.activeElement;
          if (!(at instanceof HTMLElement)) return;
          // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS selector, not words
          const typing = at.matches('input, textarea, [contenteditable="true"]');
          // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS selector, not words
          const editing = at.closest('[data-moving], [data-slot=sound-credit-form]');
          if (typing || editing) event.preventDefault();
        }}
        data-slot="review-sheet"
        className="top-4 left-4 flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex items-center gap-3 border-b border-rule-subtle px-5 py-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <DialogTitle className="truncate">
              {name ? (
                <>
                  {t`Review the reel:`} <UserContent translate="no">{name}</UserContent>
                </>
              ) : (
                t`Review the reel`
              )}
            </DialogTitle>
            <DialogDescription className="truncate">
              {t`Watch each slot, fix what’s off, approve what looks right. The chat goes on underneath.`}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button size="sm" variant="secondary" icon={REVIEW_ICONS.done}>
              {t`Done`}
            </Button>
          </DialogClose>
        </header>
        <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {template ? (
            <TemplateReview
              key={template.id}
              variant="sheet"
              template={template}
              reelUrl={reelUrl}
              sheetUrl={sheetUrl}
              projectId={projectId}
              dispatch={dispatch}
              undo={undo}
              propose={propose}
            />
          ) : (
            <p className="m-0 type-body text-ink-2">{t`This template was deleted.`}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
