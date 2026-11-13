// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pointer resolver a run asks once, before its first model call (P3-V15): parse the message, find what the
 * conversation's flow made, read that template and timeline, resolve, write the note. Logged in run.started,
 * so a resume and a replay rebuild the same prompt without asking again.
 */
import type {
  AsyncResult,
  ChatStart,
  ReferencePointer,
  RunId,
  SelectionChip,
  Template,
  TemplateId,
  Timeline,
  TimelineId,
} from '@taalcut/core';
import type { EventLogStore } from '../ports';
import { toReferencePointer } from './core-pointer';
import { flowRefs } from './flow-refs';
import { pointerNote } from './note';
import { parseReferences } from './parse';
import { resolveReferences } from './resolve';

/** Where the resolver reads the videos (the template and timeline stores, parsed to core's types). */
export interface PointerSources {
  /** A template version; the head without one. */
  template(templateId: TemplateId, version?: number): AsyncResult<Template>;
  timeline(timelineId: TimelineId): AsyncResult<Timeline>;
}

export interface PointerRequest {
  readonly message: string;
  /** The conversation's earlier runs: their logs say what its flow made. */
  readonly earlierRuns: readonly RunId[];
  readonly start?: ChatStart;
  readonly selections?: readonly SelectionChip[];
  /** EDT1: the timeline the editor shows, for a docked message: it wins over chips and the flow's. */
  readonly timelineId?: TimelineId;
  readonly log: Pick<EventLogStore, 'read'>;
}

export interface StartPointers {
  readonly pointers: ReferencePointer[];
  /** The "[Taalcut] The user pointed at:" note the run's first prompt carries. */
  readonly note: string;
}

export interface PointerResolver {
  /** Undefined: the message points at nothing (or only at what its chips already name). */
  resolve(request: PointerRequest): Promise<StartPointers | undefined>;
}

/** The value, or undefined when it can't be read: that video is then missing, and the note says so. */
async function read<T>(result: AsyncResult<T>): Promise<T | undefined> {
  const value = await result;
  return value.ok ? value.value : undefined;
}

function chipTimeline(selections: readonly SelectionChip[]): TimelineId | undefined {
  for (const chip of selections)
    if (chip.kind === 'clip' || chip.kind === 'item' || chip.kind === 'range') return chip.timelineId;
  return undefined;
}

function chipTemplate(selections: readonly SelectionChip[]): TemplateId | undefined {
  for (const chip of selections) if (chip.kind === 'slot') return chip.templateId;
  return undefined;
}

export function createPointerResolver(sources: PointerSources): PointerResolver {
  return {
    async resolve(request) {
      const parsed = parseReferences(request.message);
      if (parsed.references.length === 0) return undefined;
      const selections = request.selections ?? [];
      const refs = await flowRefs(request.log, request.earlierRuns, request.start);
      const timelineId = request.timelineId ?? chipTimeline(selections) ?? refs.timelines[0];
      const timeline = timelineId ? await read(sources.timeline(timelineId)) : undefined;
      // The template version the timeline was made from, else the flow's, else the one a chip names.
      const templateRef = timeline?.template ?? refs.template;
      const templateId = templateRef?.id ?? chipTemplate(selections);
      const template = templateId
        ? await read(sources.template(templateId, templateRef?.version))
        : undefined;
      const resolved = resolveReferences(parsed, {
        ...(template ? { template } : {}),
        ...(timeline ? { timeline } : {}),
        selections,
      });
      if (resolved.length === 0) return undefined;
      return { pointers: resolved.map(toReferencePointer), note: pointerNote(resolved) };
    },
  };
}
