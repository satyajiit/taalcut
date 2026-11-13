// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';

export interface ScrollAreaProps extends ComponentProps<'div'> {
  orientation?: 'vertical' | 'horizontal' | 'both';
}

/**
 * A native scroll container with thin, token-coloured scrollbars.
 *
 * shadcn's ScrollArea wraps Radix's, which renders an inline <style> element
 * that the app's CSP (style-src 'self') blocks. Native scrolling keeps the same
 * API shape, follows macOS's scrollbar setting and is faster on long lists.
 */
export function ScrollArea({ className, orientation = 'vertical', ...props }: ScrollAreaProps) {
  return (
    <div
      data-slot="scroll-area"
      data-orientation={orientation}
      className={cn(
        'relative min-h-0 min-w-0 scrollbar-thin overscroll-contain',
        orientation === 'vertical' && 'overflow-x-hidden overflow-y-auto',
        orientation === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        orientation === 'both' && 'overflow-auto',
        className,
      )}
      {...props}
    />
  );
}
