// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a fact's row and its parts (UX4, split out in LIB1-OEM) · system: DESIGN.md v0.7 (ListRow)
 * the pieces every row of the clip's facts is made of, shared by the facts card and the rows other lanes add to it
 *   (sound's language, the place): a dense static ListRow, a leading glyph box for a glyph of the row's own colour,
 *   and a small mark under a value
 * states: static rows only (no hover, no focus) · marks: neutral (chip, ink-2) or strong (inverse) */
import { ListRow } from '@taalcut/ui';
import type { ComponentProps, ReactNode } from 'react';

/** A fact: a dense row with no action, so a static one (it isn't something to press). */
export function Fact(props: ComponentProps<typeof ListRow>) {
  return <ListRow size="dense" static {...props} />;
}

/** A leading glyph of the row's own colour, in the box the registry's glyphs sit in. */
export function Lead({ children }: { children: ReactNode }) {
  return <span className="flex size-8 shrink-0 items-center justify-center">{children}</span>;
}

/** A small mark under a value: the HDR format, slow motion, the phone's capture mode. */
export function Mark({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={
        strong
          ? 'rounded-sm bg-inverse px-1.5 py-px type-caption font-semibold text-on-inverse'
          : 'rounded-sm bg-chip px-1.5 py-px type-caption font-semibold text-ink-2'
      }
    >
      {children}
    </span>
  );
}
