// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: memory scope picker (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · which project or template a remembered item applies to: a quiet button naming the choice
 *   (the person's own name for it, never translated) that opens a popover (hairline, lg radius) with a search box
 *   over a listbox, as ⌘K's palette is built (WAI-ARIA combobox: focus stays in the box, ↑/↓ move, Return picks,
 *   Escape closes and focus returns to the button)
 * states: default · hover · focus-visible · active · disabled (Button) · loading (skeleton lines in the list) · error
 *   (the cause and Try again) · empty (no projects or templates yet) · no match (one line naming the words) ·
 *   success (the button names the choice; the chosen option is marked)
 * motion: none of its own
 */
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { cn } from '#lib/cn';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { SkeletonLines } from '../skeleton/skeleton';

/** A project or template a remembered item can apply to: its id and the person's own name for it. */
export interface MemoryScopeOption {
  readonly id: string;
  readonly name: string;
}

export interface MemoryScopePickerProps {
  readonly kind: 'project' | 'template';
  /** The chosen one, if any. */
  readonly value: MemoryScopeOption | null;
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  readonly query: string;
  onQueryChange(query: string): void;
  /** The ones that match the query; null while they load. */
  readonly options: readonly MemoryScopeOption[] | null;
  readonly error?: TaalcutError | null;
  onRetry?(): void;
  onPick(option: MemoryScopeOption): void;
  readonly disabled?: boolean;
}

function useWords(kind: MemoryScopePickerProps['kind'], query: string) {
  const { t } = useLingui();
  return kind === 'project'
    ? {
        choose: t`Choose a project`,
        search: t`Search projects`,
        list: t`Projects`,
        none: t`There are no projects yet. Make a video first.`,
        noMatch: t`No project matches “${query}”.`,
      }
    : {
        choose: t`Choose a template`,
        search: t`Search templates`,
        list: t`Templates`,
        none: t`There are no templates yet. Save one from a video first.`,
        noMatch: t`No template matches “${query}”.`,
      };
}

function Results({
  props,
  active,
  setActive,
  listId,
  optionId,
}: {
  props: MemoryScopePickerProps;
  active: number;
  setActive: (index: number) => void;
  listId: string;
  optionId: (index: number) => string;
}) {
  const words = useWords(props.kind, props.query.trim());
  const { options, error, onRetry, value, onPick } = props;
  if (error && !options)
    return <ErrorLine key={error.code} error={error} onRetry={onRetry} className="px-2 py-1.5" />;
  if (!options) return <SkeletonLines lines={3} className="px-2" />;
  if (options.length === 0)
    return (
      <p role="status" className="m-0 px-2 py-3 type-meta text-ink-2">
        {props.query.trim() ? words.noMatch : words.none}
      </p>
    );
  return (
    <div
      id={listId}
      role="listbox"
      aria-label={words.list}
      className="flex max-h-64 scrollbar-thin flex-col overflow-y-auto overscroll-contain"
    >
      {options.map((option, index) => (
        <OptionRow
          key={option.id}
          id={optionId(index)}
          option={option}
          chosen={value?.id === option.id}
          active={index === active}
          onHover={() => setActive(index)}
          onPick={() => onPick(option)}
        />
      ))}
    </div>
  );
}

function OptionRow({
  id,
  option,
  chosen,
  active,
  onHover,
  onPick,
}: {
  id: string;
  option: MemoryScopeOption;
  chosen: boolean;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={chosen}
      data-option-id={option.id}
      data-active={active || undefined}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 type-label text-ink',
        'data-active:bg-hover',
      )}
    >
      <Check aria-hidden className={cn('size-4 shrink-0 text-ink-2', chosen ? 'opacity-100' : 'opacity-0')} />
      <UserContent translate="no" className="min-w-0 truncate">
        {option.name}
      </UserContent>
    </div>
  );
}

/**
 * The active option of a combobox's list (focus stays in the box): each new list starts on its first option,
 * ↑/↓ wrap, Home and End jump, Return picks; the active one scrolls into view.
 */
function useActiveOption(
  options: readonly MemoryScopeOption[] | null,
  onPick: (option: MemoryScopeOption) => void,
) {
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const count = options?.length ?? 0;
  useEffect(() => setActive(0), [options]);
  useEffect(() => {
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (count === 0) return;
    const moves: Record<string, number> = {
      ArrowDown: (active + 1) % count,
      ArrowUp: (active - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
      return;
    }
    const picked = options?.[active];
    if (event.key === 'Enter' && picked) {
      event.preventDefault();
      onPick(picked);
    }
  };
  return { active, setActive, listId, optionId, count, onKeyDown };
}

/** The project or template a remembered item applies to, searched and picked from a popover. */
export function MemoryScopePicker(props: MemoryScopePickerProps) {
  const { kind, value, open, onOpenChange, query, onQueryChange, options, onPick, disabled = false } = props;
  const words = useWords(kind, query.trim());
  const { active, setActive, listId, optionId, count, onKeyDown } = useActiveOption(options, onPick);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          size="sm"
          variant="secondary"
          data-slot="memory-scope-picker"
          data-kind={kind}
          disabled={disabled}
          className="max-w-full min-w-0"
        >
          <span className="min-w-0 truncate">
            {value ? <UserContent translate="no">{value.name}</UserContent> : words.choose}
          </span>
          <ChevronsUpDown aria-hidden />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="memory-scope-popover"
          aria-label={words.choose}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'z-50 flex w-80 max-w-[calc(100vw-24px)] flex-col gap-1 rounded-lg border border-rule-subtle',
            'bg-popover p-1.5 text-popover-foreground shadow-md',
          )}
        >
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
            <Input
              role="combobox"
              aria-expanded={count > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={count > 0 ? optionId(active) : undefined}
              aria-label={words.search}
              placeholder={words.search}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={onKeyDown}
              className="pl-8 text-sm"
            />
          </div>
          <Results props={props} active={active} setActive={setActive} listId={listId} optionId={optionId} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
