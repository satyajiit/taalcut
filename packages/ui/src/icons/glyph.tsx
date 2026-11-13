// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { LucideProps } from 'lucide-react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';
import { cn } from '#lib/cn';
import { ICON_SIZE, ICON_STROKE, type IconSize } from './concepts';

/** A Lucide glyph, or anything drawn to the same props (the kit's AI mark). */
export type IconComponent = ComponentType<LucideProps>;

/** What the kit's `icon` props take: a glyph from the registry (sized for you) or an element you sized yourself. */
export type IconLike = IconComponent | ReactElement;

export interface GlyphProps {
  icon: IconComponent;
  /** 14 (`sm`), 16 (`md`, the default) or 20 (`lg`) px. */
  size?: IconSize;
  className?: string;
}

/** A registry icon at one of the three sizes and the one stroke, hidden from screen readers (words name it). */
export function Glyph({ icon: Icon, size = 'md', className }: GlyphProps) {
  const px = ICON_SIZE[size];
  return (
    <Icon
      aria-hidden
      data-slot="glyph"
      size={px}
      strokeWidth={ICON_STROKE}
      className={cn('shrink-0', className)}
    />
  );
}

/** A glyph component (a function or a forwardRef/memo object), not an element or a string. */
export function isIconComponent(value: unknown): value is IconComponent {
  if (typeof value === 'function') return true;
  return typeof value === 'object' && value !== null && '$$typeof' in value && !isValidElement(value);
}

/** An `icon` prop as something to render: a glyph is sized, an element is left as the caller drew it. */
export function renderIcon(icon: IconLike | undefined, size: IconSize = 'md', className?: string): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  return <Glyph icon={icon} size={size} className={className} />;
}
