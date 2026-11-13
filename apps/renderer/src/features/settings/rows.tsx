// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: setting rows (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (the kit's ListRow, _orch/ux4/specs/design-set.md "One row")
 * one grouped list per setting group, as macOS lays them out: the kit's framed ListRows (one raised frame, rows
 *   divided by hairlines) and one row anatomy for every setting: the concept's glyph or the thing's own mark, the
 *   setting's name (type-label), one line on what it does (type-meta, ink-2, the prose measure), a status at the end
 *   (a chip or a fact) and the row's controls after it. A row whose one control is a switch is a SwitchRow; a row
 *   that is a choice is a ChoiceRow (radio-row.tsx). A row that opens a page is that link (`action`), with a chevron.
 * states: a row that acts (`action`) has the kit's hover and press; a row of facts or buttons has no wash of its own
 *   (its controls carry their eight states), so only what can be clicked looks clickable; disabled (ink-disabled) */
import { ListRow, ListRows, cn, type ListRowProps, type ListRowsProps } from '@taalcut/ui';
import { ChevronRight } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

/** The frame of a grouped list: one hairline box, rows divided by hairlines. Name it when no heading does. */
export function SettingRows({ className, ...props }: Omit<ListRowsProps, 'framed'>) {
  return <ListRows framed data-setting-rows="" className={className} {...props} />;
}

export interface SettingRowProps extends Omit<
  ListRowProps,
  'meta' | 'trailingMeta' | 'actions' | 'leading' | 'size' | 'select' | 'selecting'
> {
  /** What the setting is (type-label). */
  title: ReactNode;
  /** One line on what it does or how it stands: read, so ink-2, at the prose measure. */
  description?: ReactNode;
  /** The concept's glyph from the registry, or the thing's own mark (a provider's logo, a folder's icon). */
  icon?: ListRowProps['leading'];
  /** At the row's end before its controls: a status chip, a count, a size. */
  status?: ReactNode;
  /** The row's controls: buttons, a menu, a select. */
  control?: ReactNode;
  /** The row's one action when the whole row opens something (a link to a page); it gets a chevron. */
  action?: ReactElement;
}

/** One setting: icon, name and line, status, controls; the kit's ListRow in a SettingRows frame. */
export function SettingRow({
  title,
  description,
  icon,
  status,
  control,
  action,
  className,
  children,
  ...props
}: SettingRowProps) {
  return (
    <ListRow
      size="dense"
      title={title}
      leading={icon}
      meta={description ? <span className="block max-w-prose">{description}</span> : undefined}
      trailingMeta={
        action ? (
          <span className="flex items-center gap-2">
            {status}
            <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
          </span>
        ) : (
          status
        )
      }
      actions={control}
      {...(action ? { action } : {})}
      // Only a row that acts washes on hover: a row of facts, or of its own buttons, is static and stays still.
      static={!action}
      className={cn('min-h-12', className)}
      {...props}
    >
      {children}
    </ListRow>
  );
}
