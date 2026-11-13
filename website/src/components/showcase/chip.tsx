// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: chip · mode: Operate (inside the showcases) · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Chips and counts)
 * a soft wash with strong words, pill radius, type-caption at 600, a 14 px glyph. Tones are meanings (the AI, you,
 * beats, a status, a slot role, a format family), always with a word or an icon beside the colour.
 * states: n/a (not interactive) */

import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

export type ChipTone =
  | 'neutral'
  | 'ai'
  | 'you'
  | 'beat'
  | 'warning'
  | 'success'
  | 'hook'
  | 'peak'
  | 'outro'
  | 'story'
  | 'voice'
  | 'show'
  | 'reveal';

/** Written out whole so Tailwind finds every class. */
const TONES: Record<ChipTone, string> = {
  neutral: 'bg-chip text-ink-2',
  ai: 'bg-ai-soft text-ai-strong',
  you: 'bg-you-soft text-you-strong',
  beat: 'bg-beat-soft text-beat-strong',
  warning: 'bg-warning-soft text-warning-strong',
  success: 'bg-success-soft text-success-strong',
  hook: 'bg-slot-hook-soft text-slot-hook-strong',
  peak: 'bg-slot-peak-soft text-slot-peak-strong',
  outro: 'bg-slot-outro-soft text-slot-outro-strong',
  story: 'bg-format-story-soft text-format-story-strong',
  voice: 'bg-format-voice-soft text-format-voice-strong',
  show: 'bg-format-show-soft text-format-show-strong',
  reveal: 'bg-format-reveal-soft text-format-reveal-strong',
};

export function Chip({
  tone = 'neutral',
  className,
  children,
}: {
  readonly tone?: ChipTone;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 type-caption font-semibold whitespace-nowrap',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
