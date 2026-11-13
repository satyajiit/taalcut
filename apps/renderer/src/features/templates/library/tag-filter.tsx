// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: tag filter pill · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the library's filter pill (features/library/filter-pill.tsx) for many values: a menu of the tags in use, most used
 *   first, each a checkbox; set, the pill names the first and how many more, on the selection wash. Templates and
 *   the hub both filter tags with it (UX1: one filter idiom)
 * states: default · hover (hover surface) · focus-visible (base ring) · active (pressed surface) · open (pressed,
 *   chevron turned) · set (selection wash, strong edge) · disabled (ink-disabled, no tags yet) · loading/error/success
 *   n/a: the list answers for the filter
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taalcut/ui';
import { ChevronDown, Tag } from 'lucide-react';
import { PILL_CHEVRON_CLASS, PILL_CLASS } from './pill';

export interface TagFilterProps {
  readonly value: readonly string[];
  /** Tags in the library, most used first. */
  readonly tags: readonly string[];
  readonly onChange: (tags: readonly string[]) => void;
  /** Written before each tag: the hub shows its tags as "#food". */
  readonly prefix?: string;
}

/** The menu lists this many; more would need a search of their own. */
const SHOWN = 30;

export function TagFilter({ value, tags, onChange, prefix = '' }: TagFilterProps) {
  const { t, i18n } = useLingui();
  const set = value.length > 0;
  const more = value.length - 1;
  const extra = i18n.number(more);
  // Chosen tags first, so a tag from a link that isn't in the top thirty can still be cleared.
  const shown = [...value, ...tags.filter((tag) => !value.includes(tag))].slice(
    0,
    Math.max(SHOWN, value.length),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={tags.length === 0 && !set}
        data-slot="filter-pill"
        data-set={set || undefined}
        className={PILL_CLASS}
      >
        <Tag aria-hidden />
        {set ? (
          <span className="flex max-w-48 items-baseline gap-1 font-medium">
            <span translate="no" data-user-content className="truncate">
              {prefix}
              {value[0]}
            </span>
            {more > 0 ? <span className="shrink-0">{t`+${extra}`}</span> : null}
            <span className="sr-only">{t`Tags`}</span>
          </span>
        ) : (
          <span>{t`Tags`}</span>
        )}
        <ChevronDown aria-hidden className={PILL_CHEVRON_CLASS} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
        <DropdownMenuLabel>{t`Show templates tagged`}</DropdownMenuLabel>
        {set ? (
          <>
            <DropdownMenuItem onSelect={() => onChange([])}>{t`Any tag`}</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {shown.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            checked={value.includes(tag)}
            // The menu stays open, so several can be ticked in a row.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onChange(checked ? [...value, tag] : value.filter((each) => each !== tag))
            }
          >
            <span translate="no" data-user-content>
              {prefix}
              {tag}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
