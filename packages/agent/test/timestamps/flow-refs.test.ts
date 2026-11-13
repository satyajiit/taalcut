// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-V15: what the conversation's flow made, from the earlier runs' logs; and the note's missing videos. */
import { err, newId, unwrap, type RunId } from '@taalcut/core';
import {
  createMemoryEventLogStore,
  flowRefs,
  parseReferences,
  pointerNote,
  resolveReferences,
  type EventLogStore,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { seedFlow } from './stand-ins';
import { videos } from './videos';

describe('flowRefs', () => {
  it("the latest flow's template and timelines, variant 1 first", async () => {
    const v = videos();
    const store = createMemoryEventLogStore();
    const older = await seedFlow(store, videos());
    const newer = await seedFlow(store, v, 1_760_000_200_000);
    expect(await flowRefs(store, [newer, older])).toEqual({
      template: { id: v.template.id, version: 1 },
      timelines: [v.timeline.id],
    });
  });

  it('a template start points at its template; an unreadable or unknown run adds nothing', async () => {
    const templateId = newId<'Template'>();
    const store = createMemoryEventLogStore();
    expect(await flowRefs(store, [], { path: 'template', templateId })).toEqual({
      template: { id: templateId },
      timelines: [],
    });
    const broken: Pick<EventLogStore, 'read'> = {
      read: async () => err({ code: 'core.io', messageKey: 'errors.core.io', retryable: true }),
    };
    expect(await flowRefs(broken, [newId<'AgentRun'>() as RunId])).toEqual({ timelines: [] });
    expect(unwrap(await store.read(newId<'AgentRun'>()))).toEqual([]);
  });
});

describe('the note when a video is missing', () => {
  it('says there is no reference, no video yet, or no cut there', () => {
    const v = videos();
    const noTemplate = pointerNote(
      resolveReferences(parseReferences('in the reference, slot 2'), { timeline: v.timeline }),
    );
    expect(noTemplate).toContain('"slot 2": no reference in this conversation yet.');
    const noTimeline = pointerNote(
      resolveReferences(parseReferences('make slot 2 shorter'), { template: v.template }),
    );
    expect(noTimeline).toContain('"slot 2": no video made in this conversation yet.');
    const noCut = pointerNote(
      resolveReferences(parseReferences('copy the transition at 0:05'), { template: v.template }),
    );
    expect(noCut).toContain('"0:05": no cut within half a second of that time in the reference (at 0:05.0).');
    const past = pointerNote(
      resolveReferences(parseReferences('in the reference, at 0:30'), { template: v.template }),
    );
    expect(past).toContain('"0:30": nothing there in the reference (at 0:30.0); it is shorter.');
  });
});
