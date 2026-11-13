// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a feature's glyph · mode: Persuade · system: WEB2 Remix Vernacular
 * states: static (decoration, hidden from assistive technology). Not a control.
 * A look's glyph (look.tsx): a Lucide icon, or the AI's own mark, sized by its caller, for a row, a chip or a link.
 * The tilted pastel IconChip that sat beside every feature heading is retired (WEB2 fix batch). */

import { AiMark } from '#components/brand/ai-mark';
import { ICON_STROKE } from '#lib/icons';
import type { LookIcon } from './look';

/** A look's glyph: a Lucide icon, or the AI's own mark. */
export function LookGlyph({
  icon: Icon,
  className,
}: {
  readonly icon: LookIcon;
  readonly className?: string;
}) {
  // The AI mark takes the glyph's size class as a Lucide icon does.
  if (Icon === 'ai') return <AiMark className={className} />;
  return <Icon aria-hidden strokeWidth={ICON_STROKE} className={className} />;
}
