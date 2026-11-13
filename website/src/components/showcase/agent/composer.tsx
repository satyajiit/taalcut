// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the chat box, with how hard it thinks · mode: Operate · system: WEB2 Remix Vernacular
 * rebuilt lean from packages/ui/src/chat/composer.tsx: the message box (a drawing: "Message Taalcut" and Send), and
 *   the one thinking setting the app keeps in the chat box, said plainly as "How hard it thinks", Low, Medium or High,
 *   with the app's own line for the level chosen (thinking-levels.ts)
 * states: the choice: the segmented control's states (default, hover, focus, chosen) · its line follows the choice
 * motion: the thumb glides (the segmented control's own); reduced motion: at once */

import { ICON_STROKE, ICONS } from '#lib/icons';
import { Segmented } from '../segmented';
import type { Think } from './use-agent-run';

const LEVELS: readonly { readonly value: Think; readonly label: string; readonly line: string }[] = [
  { value: 'low', label: 'Low', line: 'Thinks a little first. Quick, for questions and small edits.' },
  { value: 'medium', label: 'Medium', line: 'Balances speed and depth. Right for most videos.' },
  { value: 'high', label: 'High', line: 'Thinks longer for harder edits. Slower, and it costs more.' },
];

export function Composer({
  think,
  onThink,
}: {
  readonly think: Think;
  readonly onThink: (think: Think) => void;
}) {
  const Send = ICONS.next;
  const chosen = LEVELS.find((l) => l.value === think) ?? LEVELS[1]!;
  return (
    <div
      data-slot="composer"
      className="@container flex flex-col gap-3 rounded-2xl border border-rule bg-canvas p-3"
    >
      <div aria-hidden className="flex items-center gap-3 ps-1">
        <span className="min-w-0 flex-1 truncate type-prose text-ink-3">Message Taalcut</span>
        <span className="inline-grid size-8 shrink-0 place-items-center rounded-pill bg-control text-ink-disabled">
          <Send strokeWidth={ICON_STROKE} className="size-4" />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-rule-subtle pt-2.5">
        <span aria-hidden className="type-label-sm text-ink">
          How hard it thinks
        </span>
        <Segmented label="How hard it thinks" options={LEVELS} value={think} onChange={onThink} />
        <span className="min-w-0 basis-full type-meta text-ink-2 @min-[34rem]:basis-auto @min-[34rem]:flex-1">
          {chosen.line}
        </span>
      </div>
    </div>
  );
}
