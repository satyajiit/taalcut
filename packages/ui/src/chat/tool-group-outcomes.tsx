// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Plural, useLingui } from '@lingui/react/macro';
import { UserContent } from '../cards/card-frame';
import { toolLabel } from '../cards/labels';
import { toolGroupLabel } from '../cards/tool-group-labels';
import { toolOutcome, ToolRunRow } from '../cards/tool-run-card';
import type { RunTool } from './tool-groups';

/** Failures keep their recovery; an in-flight image keeps its actual preview surface. */
function needsOwnRow({ card }: RunTool): boolean {
  return (
    card.status === 'failed' ||
    card.error !== undefined ||
    (card.status === 'running' &&
      (card.tool === 'images.generateForSlot' || card.tool === 'images.generateThumbnail'))
  );
}

/** Retain useful output without repeating an operation's label, status or the same summary for every call. */
export function ToolGroupOutcomes({ calls }: { calls: readonly RunTool[] }) {
  const { t, i18n } = useLingui();
  const summaries = new Set<string>();
  const artifacts = new Set<string>();
  const separate: RunTool[] = [];
  for (const call of calls) {
    if (needsOwnRow(call)) {
      separate.push(call);
      continue;
    }
    const { card } = call;
    const summary = toolOutcome(card, false, t`Motion graphic`).trim();
    const repeatsOperation =
      summary === toolLabel(i18n, card.tool) || summary === toolGroupLabel(i18n, card.tool, calls.length);
    // Captures describe where the frame came from, not a finding; their per-frame metadata stays in diagnostics.
    if (summary && !repeatsOperation && card.tool !== 'timeline.captureFrame') summaries.add(summary);
    for (const id of card.artifactIds ?? []) artifacts.add(id);
  }
  if (summaries.size === 0 && artifacts.size === 0 && separate.length === 0) return null;
  return (
    <div data-slot="tool-outcomes" className="flex min-w-0 flex-col gap-2 ps-6">
      {Array.from(summaries, (summary) => (
        <p key={summary} data-slot="tool-summary" className="m-0 break-words type-meta text-ink-2">
          <UserContent>{summary}</UserContent>
        </p>
      ))}
      {artifacts.size > 0 ? (
        <p className="m-0 type-meta text-ink-2">
          <Plural value={artifacts.size} one="# result saved" other="# results saved" />
        </p>
      ) : null}
      {separate.map(({ card }) => (
        <ToolRunRow key={card.id} card={card} />
      ))}
    </div>
  );
}
