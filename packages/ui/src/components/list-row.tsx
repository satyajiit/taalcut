// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: list row (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + the UX4 motion grammar and type roles
 * one row of a list of things (projects, templates, exports, settings): leading media or the concept's glyph, the
 *   title (type-card-title), its meta (type-meta, ink-2) and anything under it (a cut strip, a note), trailing meta
 *   (type-data, ink-3) and trailing actions. A row with one action is that action: its link or button spans the row
 *   (`action`, asChild), and the checkbox and trailing actions are its siblings, never inside it, so nothing
 *   interactive nests. One recipe: a hover pill on the canvas (`pill`), or hairline-divided rows in a raised frame
 *   (`ListRows framed`, the settings lists): never both.
 * states: default · hover (the hover surface eases in, --dur-micro) · focus (the action's base ring, instant) ·
 *   active (the pressed surface; the action gives by 1 %) · selected (the selected wash, aria-selected or a ticked
 *   box) · selecting (every row's box shows) · disabled (ink-disabled, no hover) · static (a row with no action,
 *   a fact or a summary: no hover and no press, since nothing happens) · loading, error, success: the row's
 *   content says them (a status in its meta)
 * the checkbox slot shows on hover, on keyboard focus within the row and in selection mode (DESIGN.md, Bulk
 *   selection) · reduced motion: no give; colours still ease */
import { useLingui } from '@lingui/react/macro';
import { Slot } from 'radix-ui';
import {
  createContext,
  useContext,
  useId,
  type ComponentProps,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '#lib/cn';
import { HOVER_EASE, PRESS_ROW } from '#lib/motion-classes';
import { isIconComponent, renderIcon, type IconComponent } from '../icons/glyph';
import { Checkbox } from './checkbox';

const Framed = createContext(false);

export interface ListRowsProps extends ComponentProps<'ul'> {
  /** Rows divided by hairlines in one raised frame (a settings group), instead of hover pills on the canvas. */
  framed?: boolean;
}

/** The list around ListRows (`<ul>`). Name it with aria-label when no heading does. */
export function ListRows({ framed = false, className, ...props }: ListRowsProps) {
  return (
    <Framed.Provider value={framed}>
      <ul
        data-slot="list-rows"
        data-framed={framed || undefined}
        className={cn(
          'm-0 flex list-none flex-col p-0',
          framed ? 'overflow-hidden rounded-lg border border-rule-subtle bg-raised' : 'gap-0.5',
          className,
        )}
        {...props}
      />
    </Framed.Provider>
  );
}

export interface ListRowSelect {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /**
   * The box's own name. Leave it out and the box is named "Select" plus the row's title, by reference
   * (`aria-labelledby`), so a project's name is never copied into a translated string.
   */
  label?: string;
}

export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  /** Leading media (a poster, a thumbnail) or the concept's glyph from the registry. */
  leading?: IconComponent | ReactNode;
  /** Facts under the title: counts, dates, status in words. */
  meta?: ReactNode;
  /** Facts at the row's end, before its actions: a size, a length, a time. */
  trailingMeta?: ReactNode;
  /** Buttons at the row's end (a menu, Retry). Siblings of the row's action, never inside it. */
  actions?: ReactNode;
  /** The row's one action, a link or a button element: it spans the row and its contents become the row's. */
  action?: ReactElement;
  /** The bulk-selection box, shown on hover, focus and while `selecting`. */
  select?: ListRowSelect;
  /** Selection mode: every row shows its box. */
  selecting?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /**
   * A row that does nothing (a fact, a settings summary): no hover surface and no press, so it never looks like
   * something to click. Give it no `action`; its `actions` still work as buttons of their own.
   */
  static?: boolean;
  /** `comfortable` (a poster or two lines of meta) or `dense` (one line, a settings or a file list). */
  size?: 'comfortable' | 'dense';
  /** Extra lines under the meta: a cut strip, a recovered note. */
  children?: ReactNode;
  /** `li` in ListRows (the default); `div` for a row in a windowed listbox (pass its role and aria-selected). */
  as?: 'li' | 'div';
}

const LEADING_ICON = 'flex size-8 shrink-0 items-center justify-center text-ink-3';

/** A row of a list: leading, title and meta, trailing meta and actions, with the kit's hover, press and selection. */
export function ListRow({
  title,
  leading,
  meta,
  trailingMeta,
  actions,
  action,
  select,
  selecting = false,
  selected = false,
  disabled = false,
  static: isStatic = false,
  size = 'comfortable',
  as: Root = 'li',
  className,
  children,
  ...props
}: ListRowProps) {
  const { t } = useLingui();
  const framed = useContext(Framed);
  const dense = size === 'dense';
  // A static row, like a disabled one, answers no hover and no press.
  const answers = !disabled && !isStatic;
  const titleId = useId();
  const selectWordId = useId();
  const lead = isIconComponent(leading) ? (
    <span className={LEADING_ICON}>{renderIcon(leading, 'md')}</span>
  ) : leading ? (
    <span className="flex shrink-0 items-center">{leading}</span>
  ) : null;
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={titleId} className={cn('min-w-0 text-ink', dense ? 'type-label' : 'type-card-title')}>
          {title}
        </span>
        {meta ? <span className="min-w-0 type-meta text-ink-2">{meta}</span> : null}
        {children}
      </span>
      {trailingMeta ? <span className="shrink-0 type-data text-ink-3">{trailingMeta}</span> : null}
    </>
  );
  const inner = cn(
    'flex min-w-0 flex-1 items-center text-start',
    dense ? 'gap-3 px-3 py-2' : 'gap-4 px-3 py-2.5',
    framed ? 'rounded-none' : 'rounded-lg',
  );
  return (
    <Root
      data-slot="list-row"
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      data-static={isStatic || undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        'group/row relative flex min-w-0 items-center gap-1',
        answers && HOVER_EASE,
        framed ? 'border-t border-rule-subtle first:border-t-0' : 'rounded-lg',
        answers && 'hover:bg-hover has-[[data-row-action]:active]:bg-pressed',
        'data-selected:bg-selected data-selected:hover:bg-selected aria-selected:bg-selected aria-selected:hover:bg-selected',
        disabled && 'text-ink-disabled [&_*]:text-ink-disabled',
        className,
      )}
      {...props}
    >
      {select ? (
        <span
          data-slot="list-row-select"
          className={cn(
            'flex shrink-0 items-center ps-2 transition-opacity duration-(--dur-micro) ease-(--ease-out)',
            selecting || select.checked
              ? 'opacity-100'
              : 'opacity-0 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100',
          )}
        >
          <Checkbox
            checked={select.checked}
            onCheckedChange={select.onCheckedChange}
            aria-label={select.label}
            aria-labelledby={select.label ? undefined : `${selectWordId} ${titleId}`}
            disabled={disabled}
          />
          {select.label ? null : (
            <span id={selectWordId} hidden>
              {t`Select`}
            </span>
          )}
        </span>
      ) : null}
      {action ? (
        <Slot.Root data-row-action className={cn(inner, answers && PRESS_ROW)}>
          <Slot.Slottable>{action}</Slot.Slottable>
          {body}
        </Slot.Root>
      ) : (
        <div className={inner}>{body}</div>
      )}
      {actions ? (
        <span data-slot="list-row-actions" className="flex shrink-0 items-center gap-1 pe-2">
          {actions}
        </span>
      ) : null}
    </Root>
  );
}
