// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the conversation's latest flow made, from the earlier runs' logs: its template (a template start, or
 * the Analyst's handoff) and its timelines in variant order (the Librarian's handoff, then the Editor's). A
 * reference in a new message is resolved against these. A run that starts a template flow points at that
 * template, before anything is made from it.
 */
import { parseId, type ChatStart, type RunId, type TemplateId, type TimelineId } from '@taalcut/core';
import type { AgentEvent } from '../events';
import type { EventLogStore } from '../ports';

export interface FlowRefs {
  readonly template?: { readonly id: TemplateId; readonly version?: number };
  /** Variant 1 first. */
  readonly timelines: readonly TimelineId[];
}

interface Building {
  template?: { id: TemplateId; version?: number };
  timelines: TimelineId[];
}

function apply(refs: Building, event: AgentEvent): Building {
  if (event.type === 'flow.started') {
    const start = event.payload.start;
    return { ...(start.path === 'template' ? { template: { id: start.templateId } } : {}), timelines: [] };
  }
  if (event.type !== 'skill.handedOff') return refs;
  for (const ref of event.payload.refs) {
    if (ref.entity === 'template') {
      const id = parseId<'Template'>(ref.id);
      if (id.ok) refs.template = { id: id.value, version: ref.version };
    } else if (ref.entity === 'timeline') {
      const id = parseId<'Timeline'>(ref.id);
      if (id.ok && !refs.timelines.includes(id.value)) refs.timelines.push(id.value);
    }
  }
  return refs;
}

export async function flowRefs(
  log: Pick<EventLogStore, 'read'>,
  earlierRuns: readonly RunId[],
  start?: ChatStart,
): Promise<FlowRefs> {
  if (start?.path === 'template') return { template: { id: start.templateId }, timelines: [] };
  const runs: AgentEvent[][] = [];
  for (const runId of earlierRuns) {
    const events = await log.read(runId);
    // A run whose log can't be read adds nothing; the others still say what the flow made.
    if (events.ok && events.value.length > 0) runs.push(events.value);
  }
  // In the order they started, whatever order the conversation lists them in.
  runs.sort((a, b) => (a[0]?.at ?? 0) - (b[0]?.at ?? 0));
  let refs: Building = { timelines: [] };
  for (const event of runs.flat()) refs = apply(refs, event);
  return refs;
}
