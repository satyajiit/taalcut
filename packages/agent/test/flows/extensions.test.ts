// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Flow extensions (SPEC section 25): optional steps join a flow from their anchors, asked once each; the
 * voice steps only when asked for or needed; replay reads the logged answers; a bad extension fails
 * composition with agent.flow_extension_invalid.
 */
import { ok, unwrap } from '@taalcut/core';
import {
  composeFlowExtensions,
  emptySkillRegistry,
  gapsExtension,
  voiceExtension,
  voiceFinalizeExtension,
  type AgentEvent,
  type FlowExtension,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { gapHarness, takeGapDefaults } from '../gaps/gap-harness';
import { ofType } from '../support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/abc123/' };

function start(h: ReturnType<typeof gapHarness>, message = 'Copy this reel') {
  return h.agent.start({
    conversationId: 'c1',
    projectId: h.world.projectId,
    message,
    start: { path: 'reference', reference: reel },
  });
}

/** The plan as it ran: each step's skill or tool, in order. */
function planOrder(events: readonly AgentEvent[]): string[] {
  const steps: { id: string; name: string }[] = [];
  for (const e of events) {
    if (e.type === 'plan.created')
      steps.push(...e.payload.steps.map((s) => ({ id: s.id, name: s.skill ?? s.tool ?? '' })));
    if (e.type === 'plan.updated') {
      const added = e.payload.steps.map((s) => ({ id: s.id, name: s.skill ?? s.tool ?? '' }));
      const at = e.payload.insertAfter ? steps.findIndex((s) => s.id === e.payload.insertAfter) : -1;
      if (at >= 0) steps.splice(at + 1, 0, ...added);
      else steps.push(...added);
    }
  }
  return steps.map((s) => s.name);
}

async function runToExport(h: ReturnType<typeof gapHarness>, message?: string) {
  const runId = unwrap(await start(h, message));
  // FIX-ASK: a shot with no clip asks before render; the person takes the card's fixes.
  const outcome = await takeGapDefaults(h, runId);
  return { runId, outcome, events: await h.events(runId) };
}

describe('flow extensions', () => {
  it('puts the gaps step right after the Librarian only when its timelines have gaps', async () => {
    const withGaps = await runToExport(gapHarness());
    expect(planOrder(withGaps.events)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'agent.gaps',
      'timeline.editor',
      'render.reviewer',
      'render.export',
    ]);
    expect(ofType(withGaps.events, 'flow.extended').map((e) => e.payload.extension)).toEqual(['gaps']);
    const none = await runToExport(gapHarness({ plan: ['ok', 'ok'] }));
    expect(planOrder(none.events)).not.toContain('agent.gaps');
  });

  it('adds the Voice director after the Editor only when the user asked for a voiceover', async () => {
    const asked = await runToExport(
      gapHarness({ plan: ['ok'], voice: { available: true } }),
      'Copy this reel with a voiceover',
    );
    expect(planOrder(asked.events)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'timeline.editor',
      'voice.director',
      'render.reviewer',
      'render.export',
    ]);
    const quiet = await runToExport(gapHarness({ plan: ['ok'], voice: { available: true, audio: 'music' } }));
    expect(planOrder(quiet.events)).not.toContain('voice.director');
    // In Spanish too; and never while the voice module can't run.
    const spanish = await runToExport(
      gapHarness({ plan: ['ok'], voice: { available: true } }),
      'Copia este reel con voz en off',
    );
    expect(planOrder(spanish.events)).toContain('voice.director');
    const off = await runToExport(
      gapHarness({ plan: ['ok'], voice: { available: false } }),
      'Copy it with a voiceover',
    );
    expect(planOrder(off.events)).not.toContain('voice.director');
  });

  it("adds the Voice director when the template's audio is a voice, even unasked", async () => {
    const h = gapHarness({ plan: ['ok'], voice: { available: true, audio: 'voice' } });
    expect(planOrder((await runToExport(h)).events)).toContain('voice.director');
  });

  it('finalises the voice before the Reviewer only when the voiceover has draft lines', async () => {
    const drafts = gapHarness({ plan: ['ok'], voice: { available: false, drafts: 2 } });
    const run = await runToExport(drafts);
    expect(planOrder(run.events)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'timeline.editor',
      'voice.finalize',
      'render.reviewer',
      'render.export',
    ]);
    // A tool step: the agent calls it itself, with no model turn.
    const call = ofType(run.events, 'tool.requested').find((e) => e.payload.tool === 'voice.finalize');
    expect(call?.payload.modelCallId).toMatch(/^flow:/);
    expect(drafts.finalized).toHaveLength(1);
    const clean = await runToExport(gapHarness({ plan: ['ok'], voice: { available: false, drafts: 0 } }));
    expect(planOrder(clean.events)).not.toContain('voice.finalize');
  });

  it('asks each extension once per anchor, and a replay reads the logged answers', async () => {
    const h = gapHarness({ voice: { available: true, drafts: 1 } });
    const { runId, outcome, events } = await runToExport(h, 'Copy this reel with a voiceover');
    const checks = ofType(events, 'flow.extensionChecked').map(
      (e) => `${e.payload.extension}@${e.payload.anchorStepId}`,
    );
    expect(new Set(checks).size).toBe(checks.length);
    expect(ofType(events, 'flow.extended').map((e) => e.payload.extension)).toEqual([
      'gaps',
      'voice',
      'voiceFinalize',
    ]);
    unwrap(await h.agent.answer(runId, { requestId: outcome.pending[0]!.requestId, decision: 'approve' }));
    const replay = unwrap(await h.agent.replay(runId));
    expect(replay.status).toBe('completed');
    expect(replay.toolCalls.map((c) => c.tool)).toContain('timeline.dropSlot');
  });

  it('refuses extensions whose skill or tool is missing, or whose anchor is no flow step', () => {
    const noSkill = gapsExtension({
      source: {
        read: async () =>
          ok({
            timelineId: '',
            projectId: '',
            revision: 1,
            duration: { value: 0, rate: { num: 30, den: 1 } },
            minDuration: null,
            slots: [],
          }),
      },
      registered: () => false,
    });
    const badAnchor: FlowExtension = {
      ...voiceFinalizeExtension({ draftLines: async () => ok(0) }),
      anchor: { before: 'export' },
    };
    const composed = composeFlowExtensions(
      [noSkill, voiceExtension({ available: () => true }), badAnchor, badAnchor],
      emptySkillRegistry(),
      () => false,
    );
    expect(composed.ok).toBe(false);
    if (composed.ok) return;
    expect(composed.error.code).toBe('agent.flow_extension_invalid');
    expect(composed.error.detail?.split('\n')).toEqual([
      'gaps: skill agent.gaps is not registered',
      'voice: skill voice.director is not registered',
      "voiceFinalize: anchor 'export' is not a flow skill step",
      'voiceFinalize: tool voice.finalize is not registered',
      'voiceFinalize: registered twice',
      "voiceFinalize: anchor 'export' is not a flow skill step",
      'voiceFinalize: tool voice.finalize is not registered',
    ]);
  });
});
