// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: HubTemplateRow (U4, UX1) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 · one hub template as a hairline row, the same in the chat's results card and on
 *   /templates/hub: the structure strip (hover or focus plays the first 3 s; the slot roles' marks: UX3), the name
 *   with its format as a kind chip, "@handle" (the author's words, never translated), language, length, slots (one
 *   ICU plural), the rating ("New" under 3, sky: what is new) and "In your
 *   templates" (teal: yours) when this Mac has a copy; the whole row opens it, Copy to my templates (secondary: the
 *   screen's one marigold is elsewhere; UX1 M23, not "Fork") sits above that
 * states: default · hover (hover surface; the strip plays) · focus-visible (base ring on the name; the strip plays)
 *   · active (pressed surface) · disabled (removed from the hub: Copy off, said why) · loading ("Copying")
 *   · error (the cause under the row, with its fix) · success ("In your templates" and Open)
 * motion: the strip's clock only; the row's surface is a 120 ms colour change
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { HubBrowseItem, TaalcutError, TemplateId } from '@taalcut/core';
import { CircleCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Chip } from '../components/badge';
import { Button } from '../components/button';
import { VERB_ICONS } from '../icons/concepts';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { cn } from '#lib/cn';
import { FormatChip } from '../templates/kinds';
import { useFormatters } from '#lib/format';
import { toSeconds } from '../templates/slot-words';
import { HubRatingText } from './hub-rating';
import { languageName } from './hub-words';
import { StructurePreview } from './structure-preview';

/** A hub row's data: the results card's snapshot or a browse page's item. */
export type HubRowItem = Omit<HubBrowseItem, 'description' | 'tags' | 'createdAt' | 'forkedFrom'>;

export type HubForkStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'forking' }
  | { readonly state: 'forked'; readonly templateId: TemplateId }
  | { readonly state: 'error'; readonly error: TaalcutError };

export interface HubRowFork {
  readonly status: HubForkStatus;
  onFork(): void;
  onOpenCopy(templateId: TemplateId): void;
}

export interface HubTemplateRowProps {
  readonly item: HubRowItem;
  /** Opens the template's hub page (the row and its name). */
  onOpen(): void;
  /** Fork in the row (the chat's card); without it the row only opens. */
  readonly fork?: HubRowFork;
  /** Taken off the hub since the snapshot: "Removed from the hub", Fork off. */
  readonly removed?: boolean;
  readonly className?: string;
}

function Facts({ item }: { item: HubRowItem }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const parts: ReactNode[] = [
    <UserContent key="handle" translate="no">
      @{item.handle}
    </UserContent>,
  ];
  if (item.language) parts.push(languageName(i18n, item.language));
  parts.push(format.duration(toSeconds(item.duration) * 1000));
  parts.push(t`${plural(item.slotCount, { one: '# slot', other: '# slots' })}`);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-ink-2 tabular-nums">
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="text-ink-3">
              ·
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </span>
  );
}

function ForkControl({ item, fork, removed }: { item: HubRowItem; fork: HubRowFork; removed: boolean }) {
  const { t } = useLingui();
  const status = fork.status;
  const copy = status.state === 'forked' ? status.templateId : item.forkedAs;
  if (removed)
    return (
      <Button size="sm" disabled title={t`Removed from the hub`}>
        {t`Copy to my templates`}
      </Button>
    );
  if (copy)
    return (
      <span className="flex items-center gap-2">
        <span role="status" className="flex items-center gap-1 text-sm text-you-strong">
          <CircleCheck aria-hidden className="size-4" />
          {t`In your templates`}
        </span>
        <Button size="sm" icon={VERB_ICONS.open} onClick={() => fork.onOpenCopy(copy)}>
          {t`Open`}
        </Button>
      </span>
    );
  return (
    <Button size="sm" icon={VERB_ICONS.copy} loading={status.state === 'forking'} onClick={fork.onFork}>
      {status.state === 'forking' ? t`Copying` : t`Copy to my templates`}
    </Button>
  );
}

export function HubTemplateRow({ item, onOpen, fork, removed = false, className }: HubTemplateRowProps) {
  const { t } = useLingui();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const forked = fork?.status.state === 'forked' || item.forkedAs !== null;
  const error = fork?.status.state === 'error' ? fork.status.error : null;
  return (
    <li
      data-slot="hub-row"
      data-hub-id={item.id}
      data-removed={removed || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        'relative flex flex-col gap-2 rounded-lg px-2 py-2.5 transition-colors duration-(--dur-micro) ease-(--ease-out)',
        'hover:bg-hover has-[[data-row-open]:active]:bg-pressed',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StructurePreview
          mode="strip"
          strip={item}
          playing={hovered || focused}
          describe={false}
          label={t`Structure`}
          className="w-32 shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* The name keeps its width (cut only at the row's); the format chip wraps under a long one. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              data-row-open
              onClick={onOpen}
              className="w-fit max-w-full shrink-0 cursor-pointer truncate rounded-sm text-start text-md font-medium text-ink after:absolute after:inset-0 after:rounded-lg"
            >
              <UserContent translate="no">{item.name}</UserContent>
            </button>
            {item.formatId ? <FormatChip formatId={item.formatId} /> : null}
          </span>
          <Facts item={item} />
          {removed ? <span className="text-sm text-warning-strong">{t`Removed from the hub`}</span> : null}
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-3">
          {forked && !fork ? <Chip tone="you">{t`In your templates`}</Chip> : null}
          <HubRatingText rating={item.rating} />
          {fork ? <ForkControl item={item} fork={fork} removed={removed} /> : null}
        </div>
      </div>
      {error ? <ErrorLine error={error} className="relative z-10" /> : null}
    </li>
  );
}
