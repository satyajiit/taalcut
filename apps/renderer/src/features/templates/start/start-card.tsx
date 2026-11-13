// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Start from…'s card (UX4 tpl; design-tpl.md, "The Start from… card") · system:
 *   DESIGN.md v0.6 + UX4 (the kit's Button, icons, motion grammar)
 * one anatomy for a starter, a format and a community template: a preview on the viewer grey (the structure as a
 *   storyboard that plays on hover or focus; a format's beat grid), the name (with its kind mark), one line, the
 *   facts, then Use for a video (the card's main action, a filled control: the screen's one marigold stays on a
 *   single page, never repeated across a grid) and Copy to my templates (ghost). A copy made here turns Copy into
 *   Open my copy and says it is in your templates (teal: yours)
 * states: card default · hover (rule-strong edge; the preview plays) · focus-within (the preview plays; buttons
 *   carry the base ring) · Use loading (copying, then the chat opens) · Copy loading ("Copying") · copied (teal
 *   line, Open my copy) · error (the cause under the actions, read out) · disabled (the other action while one runs)
 * motion: the preview's clock (compositor); buttons give by 2 %; the copied line arrives with a fade
 */
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError, TemplateId } from '@taalcut/core';
import { Button, cn, ErrorLine, HOVER_EASE } from '@taalcut/ui';
import { CircleCheck } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { TEMPLATE_ICONS } from '../template-icons';
import { useStartActions, type Copyable } from './use-start';

export interface StartCardProps {
  /** The name as shown (a starter's in this language, a shared one's as written). */
  readonly title: ReactNode;
  /** The name in words, for the chat it starts. */
  readonly name: string;
  /** The format's kind mark before the name. */
  readonly mark?: ReactNode;
  /** The preview on the viewer grey; told when the card is pointed at or focused, so it can play. */
  readonly preview: (playing: boolean) => ReactNode;
  readonly line: ReactNode;
  /** A person's own words (a community description) can run long: cut them at two lines. Ours show whole. */
  readonly clampLine?: boolean;
  readonly facts?: ReactNode;
  /** A starter or community template: Use copies it first, and Copy is offered. */
  readonly source?: Copyable;
  /** A format: Use opens a chat with its ask, and there is nothing to copy. */
  readonly onUse?: () => void;
  readonly className?: string;
  readonly 'data-starter'?: string;
  readonly 'data-format'?: string;
  readonly 'data-hub-id'?: string;
}

/** The grid the cards sit in: as many to a row as fit, each at least 15 rem, rows as tall as the tallest card. */
export const CARD_GRID =
  'm-0 grid list-none auto-rows-fr grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 p-0';

/** The cards' shape before their bones are captured (and where a capture has none): cards in the grid's shape. */
export function CardBones({ count = 8 }: { count?: number }) {
  return (
    <ul aria-hidden className={CARD_GRID}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="tc-bone h-[15.5rem] rounded-xl bg-hover" />
      ))}
    </ul>
  );
}

export function StartCard({
  title,
  name,
  mark,
  preview,
  line,
  clampLine = false,
  facts,
  source,
  onUse,
  className,
  ...data
}: StartCardProps) {
  const { t } = useLingui();
  const actions = useStartActions();
  const [busy, setBusy] = useState<'use' | 'copy' | null>(null);
  const [copied, setCopied] = useState<TemplateId | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const copy = copied ?? (source?.kind === 'community' ? source.forkedAs : null);
  // Every card's buttons have the same words: each is described by its card's name, so a list of them is clear.
  const titleId = useId();

  const run = async (what: 'use' | 'copy') => {
    if (!source) return;
    setBusy(what);
    setError(null);
    const done = what === 'use' ? await actions.use(source, name) : await actions.copy(source);
    setBusy(null);
    if (!done.ok) setError(done.error);
    else if (what === 'copy') setCopied(done.value.templateId);
  };

  return (
    <li className="flex">
      <article
        data-slot="start-card"
        {...data}
        onPointerEnter={() => setPointed(true)}
        onPointerLeave={() => setPointed(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
        className={cn(
          'flex w-full min-w-0 flex-col gap-3 rounded-xl border border-rule bg-raised p-3 shadow-xs',
          HOVER_EASE,
          'hover:border-rule-strong focus-within:border-rule-strong',
          className,
        )}
      >
        <div aria-hidden className="tc-viewer flex h-24 items-center rounded-lg px-3">
          {preview(pointed || focused)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 px-1">
          <h3 className="m-0 flex min-w-0 items-center gap-2 type-card-title text-ink">
            {mark}
            <span id={titleId} className="min-w-0">
              {title}
            </span>
          </h3>
          <p className={cn('m-0 type-meta text-ink-2', clampLine && 'line-clamp-2')}>{line}</p>
          {facts ? <p className="m-0 type-meta text-ink-2 tabular-nums">{facts}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 px-1">
          <Button
            size="sm"
            icon={TEMPLATE_ICONS.makeVideo}
            loading={busy === 'use'}
            disabled={busy === 'copy'}
            onClick={() => (onUse ? onUse() : void run('use'))}
            data-action="use"
            aria-describedby={titleId}
          >
            {t`Use for a video`}
          </Button>
          {source ? (
            copy ? (
              <Button
                size="sm"
                variant="ghost"
                icon={TEMPLATE_ICONS.open}
                onClick={() => actions.open(copy)}
                data-action="open-copy"
                aria-describedby={titleId}
              >
                {t`Open my copy`}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon={TEMPLATE_ICONS.copy}
                loading={busy === 'copy'}
                disabled={busy === 'use'}
                onClick={() => void run('copy')}
                data-action="copy"
                aria-describedby={titleId}
              >
                {busy === 'copy' ? t`Copying` : t`Copy to my templates`}
              </Button>
            )
          ) : null}
        </div>
        {copy ? (
          <p
            role="status"
            className="m-0 flex items-center gap-1.5 px-1 type-meta text-you-strong animate-fade-in"
          >
            <CircleCheck aria-hidden className="size-3.5 shrink-0" />
            {t`In your templates`}
          </p>
        ) : null}
        {error ? <ErrorLine error={error} className="px-1" /> : null}
      </article>
    </li>
  );
}
