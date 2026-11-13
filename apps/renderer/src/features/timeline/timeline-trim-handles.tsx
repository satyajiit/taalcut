// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { cn } from '@taalcut/ui';

/** The parent owns the gesture, so either edge keeps pointer capture while its item resizes. */
export function TimelineTrimHandles({
  selected,
  active,
}: {
  readonly selected: boolean;
  readonly active?: 'start' | 'end' | null;
}) {
  return (['start', 'end'] as const).map((edge) => (
    <span
      key={edge}
      aria-hidden
      data-trim-edge={edge}
      className={cn(
        'absolute inset-y-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center opacity-0 transition-opacity duration-(--dur-micro) group-hover:opacity-100 group-focus-visible:opacity-100',
        edge === 'start' ? 'left-0' : 'right-0',
        (selected || active === edge) && 'opacity-100',
      )}
    >
      <span className="pointer-events-none h-3 w-0.5 rounded-pill bg-current" />
    </span>
  ));
}
