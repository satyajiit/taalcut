// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Taalcut's scale has names tailwind-merge doesn't know (text-display, rounded-clip,
// rounded-pill). Without these it would treat text-display as a colour and drop it
// when merged with text-ink, or keep two conflicting radii.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'md', 'display'],
      radius: ['clip', 'pill'],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (the last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
