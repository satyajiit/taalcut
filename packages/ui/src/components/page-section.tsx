// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: page section (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + the UX4 type roles
 * one part of a page: an icon-led heading (the concept's glyph in ink-3, never a tile), an optional line on what it
 *   is for, and the section's own actions at the heading's other end; then its content. One rhythm everywhere: the
 *   heading sits 16 px above its content and its line 4 px under it; a section after another has 40 px above it
 *   (48 with a hairline), more than anything inside it, so the page reads as its parts. Level 2 (h2, type-section,
 *   20 px glyph) for a page's sections; level 3 (h3, type-card-title, 16 px glyph) for a part inside one.
 *   The base of the settings Section, the export dialog's SectionFrame and the Templates pages' headings.
 * states: n/a (not a control; its actions carry their own eight)
 * contrast: ink on canvas ≥ 7:1; the description in ink-2 ≥ 7:1; the glyph in ink-3 ≥ 4.5:1 */
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { renderIcon, type IconLike } from '../icons/glyph';

export interface PageSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  /** The section's concept from the icon registry, before the title. */
  icon?: IconLike;
  /** One line on what the section is for (≤ 65 characters a line). */
  description?: ReactNode;
  /** The section's own actions, at the heading's end (they wrap under it when the column is narrow). */
  actions?: ReactNode;
  /** 2: a section of the page (h2). 3: a part inside a section (h3). */
  level?: 2 | 3;
  /** A hairline above it, for a page of many sections (Settings). */
  divided?: boolean;
  /** An id for the heading, when something else points at it; one is made otherwise. */
  headingId?: string;
}

/** A page's section: icon-led heading, line and actions, then the content, in the kit's one rhythm. */
export function PageSection({
  title,
  icon,
  description,
  actions,
  level = 2,
  divided = false,
  headingId,
  className,
  children,
  ...props
}: PageSectionProps) {
  const made = useId();
  const id = headingId ?? made;
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-labelledby={id}
      data-slot="page-section"
      data-level={level}
      className={cn(
        'flex min-w-0 flex-col',
        level === 2 ? 'gap-4' : 'gap-3',
        // More space above a section than inside it; the first one starts at the top of its column.
        divided
          ? '[[data-slot=page-section]+&]:mt-6 [[data-slot=page-section]+&]:border-t [[data-slot=page-section]+&]:border-rule-subtle [[data-slot=page-section]+&]:pt-6'
          : level === 2
            ? '[[data-slot=page-section]+&]:mt-10'
            : '[[data-slot=page-section]+&]:mt-8',
        className,
      )}
      {...props}
    >
      <div
        data-slot="page-section-header"
        className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3"
      >
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          <Heading
            id={id}
            className={cn(
              'm-0 flex items-center text-ink',
              level === 2 ? 'gap-2 type-section' : 'gap-1.5 type-card-title',
            )}
          >
            {renderIcon(icon, level === 2 ? 'lg' : 'md', 'text-ink-3')}
            <span className="min-w-0">{title}</span>
          </Heading>
          {description ? (
            <p data-slot="page-section-description" className="m-0 max-w-prose type-meta text-ink-2">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div data-slot="page-section-actions" className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
