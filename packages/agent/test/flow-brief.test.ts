// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M12 (SPEC section 13): a brief alone reaches the one approval. "Make a
 * 30 s reel of my Goa trip" starts the describe flow from chat (startFlow);
 * "Make something from my latest" starts the library flow, whose brief skill
 * proposes the brief from the newest footage. Neither asks anything before
 * the export card except how many variants.
 */
import { FORMAT_IDS, unwrap } from '@taalcut/core';
import type { AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { ofType } from './support/harness';

const steps = (events: readonly AgentEvent[]) =>
  ofType(events, 'plan.created')[0]?.payload.steps.map((s) => s.skill ?? s.tool);

describe('a brief reaches the export card', () => {
  it('describe: the main model starts the flow from the message and the Librarian casts from the brief', async () => {
    const brief = { text: 'A 30 s reel of my Goa trip', targetSeconds: 30 };
    const h = flowHarness({ script: flowScript({ startFlow: { path: 'describe', brief }, ask: false }) });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Make a 30 s reel of my Goa trip',
      }),
    );
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    // The planning turn offered startFlow and only the paths whose skills are registered.
    const plan = h.models.requests[0]!;
    const startFlow = plan.tools?.find((t) => t.name === 'startFlow');
    expect(JSON.stringify(startFlow?.parameters)).toContain(
      '"options":["library","reference","template","describe"]',
    );
    // Every format templates can plan (P3-V1: all eight) is offered for the brief.
    for (const formatId of FORMAT_IDS)
      expect(JSON.stringify(startFlow?.parameters)).toContain(`"${formatId}"`);
    const events = await h.events(runId);
    expect(ofType(events, 'flow.started')[0]?.payload).toMatchObject({ path: 'describe', input: { brief } });
    expect(steps(events)).toEqual([
      'timeline.librarian',
      'timeline.editor',
      'render.reviewer',
      'render.export',
    ]);
    const librarian = ofType(events, 'skill.entered').find((e) => e.payload.skill === 'timeline.librarian');
    expect(librarian?.payload.input).toMatchObject({
      projectId: h.world.projectId,
      brief: { text: brief.text },
    });
    expect(h.world.calls).toContain('timeline.cast:1');
    expect(ofType(events, 'card.sent').at(-1)?.payload.card.type).toBe('exportApproval');
    expect(ofType(events, 'approval.requested').map((e) => e.payload.kind)).toEqual(['tool']);
  });

  it('library: the brief skill proposes a brief from the newest footage, then the Librarian casts', async () => {
    const h = flowHarness({ script: flowScript({ ask: false }) });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: '',
        start: { path: 'library' },
      }),
    );
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome.status).toBe('paused');
    const events = await h.events(runId);
    expect(steps(events)).toEqual([
      'agent.brief',
      'timeline.librarian',
      'timeline.editor',
      'render.reviewer',
      'render.export',
    ]);
    expect(h.world.calls.slice(0, 2)).toEqual(['library.listSources', 'timeline.cast:1']);
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.brief');
    expect(handed?.payload.output).toEqual({
      text: 'A 30 s reel of the Goa trip, upbeat.',
      targetSeconds: 30,
    });
    const librarian = ofType(events, 'skill.entered').find((e) => e.payload.skill === 'timeline.librarian');
    expect(librarian?.payload.input).toMatchObject({
      brief: { text: 'A 30 s reel of the Goa trip, upbeat.' },
    });
    // The brief step's card shows the proposal under the step's id so the user can change it.
    const briefCard = ofType(events, 'card.sent')[0]?.payload.card;
    expect(briefCard?.id).toMatch(/^step:.+:agent\.brief$/);
  });

  it('describe from a bundled format: the brief carries the format the opening card picked', async () => {
    const h = flowHarness({ script: flowScript({ ask: false }) });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Make a video in the Vlog format',
        start: { path: 'describe', formatId: 'vlog' },
      }),
    );
    unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);
    const librarian = ofType(events, 'skill.entered').find((e) => e.payload.skill === 'timeline.librarian');
    expect(librarian?.payload.input).toMatchObject({
      brief: { text: 'Make a video in the Vlog format', formatId: 'vlog' },
    });
  });

  it('a path whose skills are not registered is not offered, and an opening card for it fails plainly', async () => {
    const h = flowHarness({ script: flowScript(), without: ['templates', 'agent'] });
    const outcome = unwrap(
      await h.agent.run({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy this',
        start: { path: 'reference', reference: { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' } },
      }),
    );
    expect(outcome).toMatchObject({
      status: 'failed',
      error: { code: 'agent.skill_not_found', detail: 'The reference flow needs skill templates.analyst.' },
    });
    const chat = flowHarness({ script: flowScript(), without: ['templates', 'agent'] });
    unwrap(await chat.agent.run({ conversationId: 'c', projectId: chat.world.projectId, message: 'hi' }));
    const offered = chat.models.requests[0]?.tools?.find((t) => t.name === 'startFlow');
    expect(JSON.stringify(offered?.parameters)).toContain('"options":["template","describe"]');
  });
});
