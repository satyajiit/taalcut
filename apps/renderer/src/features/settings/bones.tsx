// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: settings skeleton fixtures · genre: atmospheric studio app · system: DESIGN.md v0.6 + UX4
 * the shapes Settings' skeletons are captured from (pnpm --filter @taalcut/renderer bones:capture renders a
 * <Skeleton>'s fixture in the capture browser): the real SettingRows frame and dense rows, the PageSection heading
 * with its glyph, and the control boxes, with blocks the size of their words. Never shown to people: at runtime the
 * captured bones draw in their place.
 */
import { cn } from '@taalcut/ui';
import type { CSSProperties, ReactNode } from 'react';


/** A block the size of a line of text `width` wide (a `ch` or `%` width), in the line height of its parent. */
export function Bone({ width, className }: { width: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-[1lh] max-w-full rounded-sm align-top', className)}
      style={{ width } as CSSProperties}
    />
  );
}

/** What sits at the right of a row: a switch, a small button, or nothing. */
export type BoneControl = 'switch' | 'button' | 'none';

export interface BoneRowShape {
  /** Width of the row's name. */
  readonly title: string;
  /** Widths of the lines under it. */
  readonly lines?: readonly string[];
  readonly control?: BoneControl;
  /** A 16 px icon or logo before the words. */
  readonly icon?: boolean;
}

/** One grouped list with rows of these shapes: the same frame and padding as the real SettingRows. */
export function BoneRows({ rows }: { rows: readonly BoneRowShape[] }) {
  return (
    <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-rule-subtle bg-raised p-0">
      {rows.map((row, index) => (
        <li
          key={index}
          className="flex min-h-12 items-center gap-3 border-t border-rule-subtle px-3 py-2 first:border-t-0"
        >
          {row.icon ? (
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center">
              <span className="size-4 rounded-sm" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="type-label">
              <Bone width={row.title} />
            </span>
            {(row.lines ?? []).map((width, line) => (
              <span key={line} className="type-meta">
                <Bone width={width} />
              </span>
            ))}
          </div>
          {row.control && row.control !== 'none' ? (
            <span
              aria-hidden
              className={cn('shrink-0', row.control === 'switch' ? 'h-5 w-9 rounded-pill' : 'h-8 w-20 rounded-md')}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** A section's heading and description, as PageSection draws them: the glyph, the words, the line. */
export function BoneHeading({ title, lines = ['60%'] }: { title: string; lines?: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 type-section">
        <span aria-hidden className="size-5 shrink-0 rounded-sm" />
        <Bone width={title} />
      </span>
      {lines.map((width, index) => (
        <span key={index} className="type-meta">
          <Bone width={width} />
        </span>
      ))}
    </div>
  );
}

/** A section's worth of bones: its heading, then `children` (BoneRows, usually), spaced as PageSection spaces them. */
export function BoneSection({
  title,
  lines,
  children,
}: {
  title: string;
  lines?: readonly string[];
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <BoneHeading title={title} {...(lines ? { lines } : {})} />
      {children}
    </div>
  );
}
