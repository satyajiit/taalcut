// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: AI pick chip · mode: Persuade (product UI, shown bare) · system: WEB2 Remix Vernacular (violet is the AI)
 * states: static (a label, never a control) · contrast: violet-strong on violet-soft holds 4.5:1 in both themes
 * The app's chip: the Avartan beat-three mark and the words, never a sparkle and never the colour alone. */

import { AiMark } from '#components/brand/ai-mark';
import { cn } from '#lib/cn';
import { DEMO } from '#components/hero/copy';

export function AiPickChip({ className }: { readonly className?: string }) {
  return (
    <span
      data-slot="ai-pick"
      className={cn('inline-flex h-5.5 shrink-0 items-center gap-1 rounded-pill bg-violet-soft px-2 type-label-sm font-semibold whitespace-nowrap text-violet-strong', className)}
    >
      <AiMark className="size-3.5" />
      {DEMO.aiPick}
    </span>
  );
}
