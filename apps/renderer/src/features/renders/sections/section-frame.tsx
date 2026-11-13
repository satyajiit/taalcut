// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: export section frame (UX4: inside a step) · system: DESIGN.md v0.6 + UX4
 * a section of an export step, unboxed on the dialog. In a step of its own the step's heading names it, so the
 *   section shows no heading of its own (its name stays on the region for assistive tech); in a step with others
 *   (Sound, Credits) it leads with an h4 in type-label. One quiet line of help or cause in ink-2 (type-meta).
 *   AskRow: something only Taalcut can make (music, hits, captions): what it is and how, and a secondary button
 *   with the AI mark that puts the request in the chat, unsent.
 * states: the frame has none · AskRow's button: default, hover, focus-visible, active, disabled (while the export
 *   starts); loading/error/success belong to the chat it opens
 */
import { createContext, useContext, useId, type ReactNode } from 'react';
import { AiMark, Button, cn } from '@taalcut/ui';
import type { ExportSectionId } from './types';

/** Whether a section shows its own heading: off when it is the only section in its step. */
export const SectionHeadings = createContext(true);

export function SectionFrame({
  id,
  title,
  aside,
  children,
  className,
}: {
  id: ExportSectionId;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const heading = useId();
  const shown = useContext(SectionHeadings);
  return (
    <section
      data-section={id}
      {...(shown ? { 'aria-labelledby': heading } : { 'aria-label': title })}
      className={cn('flex min-w-0 flex-col gap-2.5', className)}
    >
      {shown || aside ? (
        <div className="flex min-h-6 items-center justify-between gap-3">
          {shown ? (
            <h4 id={heading} className="m-0 type-label text-ink">
              {title}
            </h4>
          ) : (
            <span />
          )}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One quiet line under a control: what it does, or why it can't. */
export function SectionNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('m-0 type-meta text-ink-2', className)}>{children}</p>;
}

/** Something Taalcut makes in the chat (paid work goes through it): what, how, and the button that asks. */
export function AskRow({
  label,
  note,
  action,
  onAsk,
  disabled,
}: {
  label: string;
  note: string;
  action: string;
  onAsk: () => void;
  disabled: boolean;
}) {
  return (
    <div data-slot="ask-row" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <span className="type-body text-ink">{label}</span>
        <span className="type-meta text-ink-2">{note}</span>
      </span>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={onAsk}>
        <AiMark />
        {action}
      </Button>
    </div>
  );
}
