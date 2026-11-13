// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: icon text · mode: Persuade · system: WEB2 Remix Vernacular
 * states: static (default) · inside a link or button it takes that control's states (hover, focus, active) from the
 *   parent; nothing of its own to disable, load or fail
 * A Lucide icon (or a brand icon, or a mark such as the AI's) and its words on one line: every list row and fact on
 * the site. The icon is aria-hidden and sits centred on the first line, so a label that wraps hangs under itself. Its
 * colour can carry a job (ai violet, beat rose, you teal, action marigold); the words stay ink. */

import type { LucideIcon } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { BrandIcon, type BrandIconId } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';

export type IconTone = 'current' | 'muted' | 'ai' | 'beat' | 'you' | 'action';

export const ICON_TONES: Readonly<Record<IconTone, string>> = {
  current: 'text-current',
  muted: 'text-ink-3',
  ai: 'text-violet-strong',
  beat: 'text-rose-strong',
  you: 'text-teal-strong',
  action: 'text-marigold-strong',
};

const SIZES = {
  sm: { gap: 'gap-1.5', icon: 'size-3.5' },
  md: { gap: 'gap-2', icon: 'size-4' },
  lg: { gap: 'gap-2.5', icon: 'size-5' },
} as const;

export interface IconTextProps {
  /** A Lucide glyph (pick from #lib/icons where one fits). */
  readonly icon?: LucideIcon;
  /** Or a brand's SVGL icon, in its own colours. */
  readonly brand?: BrandIconId;
  /** Or any other drawn mark (the AI's mark: <AiMark />). */
  readonly mark?: ReactNode;
  readonly children: ReactNode;
  readonly tone?: IconTone;
  readonly size?: keyof typeof SIZES;
  /** The element: span (default), li, p, div, dt or dd. */
  readonly as?: 'span' | 'li' | 'p' | 'div' | 'dt' | 'dd';
  readonly className?: string;
}

export function IconText({ icon: Icon, brand, mark, children, tone = 'current', size = 'md', as = 'span', className }: IconTextProps) {
  const Tag = as as ElementType;
  const s = SIZES[size];
  return (
    <Tag data-slot="icon-text" className={cn('inline-flex items-start', s.gap, className)}>
      <span aria-hidden className={cn('inline-flex h-[1lh] shrink-0 items-center', ICON_TONES[tone])}>
        {Icon ? (
          <Icon data-slot="icon" strokeWidth={ICON_STROKE} className={s.icon} />
        ) : brand ? (
          <BrandIcon id={brand} className={s.icon} />
        ) : (
          <span className={cn('inline-flex items-center justify-center', s.icon)}>{mark}</span>
        )}
      </span>
      <span className="min-w-0">{children}</span>
    </Tag>
  );
}
