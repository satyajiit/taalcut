// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P1-G2: the loop's states, tool calls, artifacts by reference and the result cache. */
import { unwrap } from '@taalcut/core';
import type { ChatMessage } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, plan, toolText, turns, types } from './support/harness';

const start = { conversationId: 'conv-1', message: 'How many words are in "hook in the first second"?' };

describe('the loop', () => {
  it('plans, routes, acts, observes, verifies, checkpoints and reports, writing each event first', async () => {
    const h = harness({
      script: turns(
        plan('Count the words'),
        { toolCalls: [call('clips_countWords', { text: 'hook in the first second' })] },
        { text: 'It has 5 words.' },
      ),
    });
    const outcome = unwrap(await h.agent.run(start));
    expect(outcome).toMatchObject({ status: 'completed', report: 'It has 5 words.', pending: [] });
    const events = await h.events(outcome.runId);
    expect(types(events)).toEqual([
      'run.started',
      'model.requested',
      'model.responded',
      'tool.requested',
      'plan.created',
      'tool.completed',
      'step.started',
      'route.chosen',
      'model.requested',
      'model.responded',
      'tool.requested',
      'tool.completed',
      'model.requested',
      'model.responded',
      'verify.result',
      'checkpoint.saved',
      'run.completed',
    ]);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(ofType(events, 'run.completed')[0]?.payload.did).toEqual(['clips.countWords']);
    expect(ofType(events, 'route.chosen')[0]?.payload.tools).toContain('clips.countWords');
    const result = ofType(events, 'tool.completed')[1]?.payload;
    expect(result?.output).toEqual({ kind: 'inline', value: { words: 5 } });

    const cards = h.ui.flatMap((e) => (e.type === 'agent.card' ? [e.card.kind] : []));
    expect(cards).toEqual(expect.arrayContaining(['plan', 'toolRun']));
    expect(h.ui.at(-1)).toEqual({
      type: 'agent.run.status',
      runId: outcome.runId,
      status: 'completed',
      report: 'It has 5 words.',
    });
  });

  it('answers in one model call when the request needs no tools', async () => {
    const h = harness({ script: turns({ text: 'Hi! Send me a reel or some clips.' }) });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'hello' }));
    expect(outcome.report).toBe('Hi! Send me a reel or some clips.');
    expect(h.models.requests).toHaveLength(1);
  });

  it('sends the soul, the rules and the catalogue as the system prompt, and the loaded tools', async () => {
    const h = harness({ script: turns(plan('Count'), { text: 'Done.' }) });
    unwrap(await h.agent.run(start));
    const [first, second] = h.models.requests;
    expect(first?.system).toContain('You are Taalcut');
    expect(first?.system).toContain('clips: clips.deleteClip: Deletes a clip');
    expect(first?.tools?.map((t) => t.name)).toEqual(['updatePlan']);
    expect(second?.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(['updatePlan', 'findTools', 'readArtifact', 'clips_countWords']),
    );
    expect(second?.trace?.runId).toBeDefined();
  });

  it('walks a multi-step plan, telling the model which step it is on', async () => {
    const h = harness({
      script: turns(
        plan('List clips', 'Count words'),
        { toolCalls: [call('clips_listClips', { count: 2 })] },
        { text: 'Listed.' },
        { text: 'Counted.' },
      ),
    });
    const outcome = unwrap(await h.agent.run(start));
    expect(outcome.report).toBe('Counted.');
    const last = h.models.requests.at(-1)!.messages;
    expect(last).toContainEqual({ role: 'user', content: '[Taalcut] Step 2 of 2: Count words' });
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'checkpoint.saved').map((e) => e.payload.stepId)).toEqual(['s1', 's2']);
  });

  it('loads more tools when the model asks with findTools', async () => {
    const h = harness({
      script: turns(
        plan('Tidy up'),
        { toolCalls: [call('findTools', { query: 'share a clip publicly' })] },
        { text: 'Found it.' },
      ),
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'tidy' }));
    const loaded = ofType(await h.events(outcome.runId), 'tool.completed')[1]?.payload.loaded;
    expect(loaded?.[0]).toBe('clips.shareClip');
    expect(h.models.requests.at(-1)?.tools?.map((t) => t.name)).toContain('clips_shareClip');
  });

  it('sends unknown tools and bad arguments back to the model as errors', async () => {
    const h = harness({
      script: turns(
        plan('Count'),
        { toolCalls: [call('clips_teleport'), call('clips_countWords', { text: 42 })] },
        { text: 'Sorry.' },
      ),
    });
    const outcome = unwrap(await h.agent.run(start));
    const failed = ofType(await h.events(outcome.runId), 'tool.failed').map((e) => e.payload.error.code);
    expect(failed).toEqual(['tools.not_found', 'tools.invalid_input']);
    const toolMessages = h.models.requests
      .at(-1)!
      .messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool');
    expect(toolMessages.at(-1)).toMatchObject({ isError: true, toolName: 'clips_countWords' });
    expect(String(toolMessages.at(-1)?.content)).toMatch(/^Error tools\.invalid_input: /);
  });
});

describe('parallel tool calls', () => {
  it('runs independent reads at the same time', async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      barrier: async (id) => {
        started.push(id);
        if (started.length === 2) release();
        // Run one at a time and this wait never ends: the call would time out instead.
        await bothStarted;
      },
      script: turns(
        plan('Wait'),
        { toolCalls: [call('clips_waitAtBarrier', { id: 'a' }), call('clips_waitAtBarrier', { id: 'b' })] },
        { text: 'Both done.' },
      ),
    });
    const outcome = unwrap(await h.agent.run(start));
    const done = ofType(await h.events(outcome.runId), 'tool.completed').slice(1);
    expect(done.map((e) => e.payload.output)).toEqual([
      { kind: 'inline', value: { id: 'a' } },
      { kind: 'inline', value: { id: 'b' } },
    ]);
  });

  it('runs state changes one at a time, in the model’s order, after the reads', async () => {
    const log: string[] = [];
    const h = harness({
      onWrite: (phase, id) => log.push(`${phase}:${id}`),
      script: turns(
        plan('Rename'),
        {
          toolCalls: [
            call('clips_renameClip', { id: 'c2', title: 'Two' }),
            call('clips_renameClip', { id: 'c1', title: 'One' }),
            call('clips_countWords', { text: 'a b' }),
          ],
        },
        { text: 'Renamed.' },
      ),
    });
    const outcome = unwrap(await h.agent.run(start));
    expect(log).toEqual(['start:c2', 'end:c2', 'start:c1', 'end:c1']);
    expect(h.applied.map((a) => (a.payload as { id: string }).id)).toEqual(['c2', 'c1']);
    // The tool messages go back to the model in the order it asked, whatever order they finished in.
    const toolNames = h.models.requests
      .at(-1)!
      .messages.filter((m) => m.role === 'tool')
      .map((m) => (m.role === 'tool' ? m.toolName : ''));
    expect(toolNames.slice(1)).toEqual(['clips_renameClip', 'clips_renameClip', 'clips_countWords']);
    expect(outcome.status).toBe('completed');
  });
});

describe('artifacts and the cache', () => {
  it('passes large outputs by reference and lets the model page through them', async () => {
    const h = harness({
      script: (request, turn) => {
        if (turn === 0) return plan('List');
        if (turn === 1) return { toolCalls: [call('clips_listClips', { count: 400 })] };
        if (turn === 2) {
          const ref = /Stored as artifact (\S+)/.exec(toolText(request.messages.at(-1)))?.[1] ?? 'none';
          return { toolCalls: [call('readArtifact', { id: ref, limit: 64 })] };
        }
        return { text: 'There are 400 clips.' };
      },
    });
    const outcome = unwrap(await h.agent.run(start));
    const events = await h.events(outcome.runId);
    const listed = ofType(events, 'tool.completed')[1]?.payload.output;
    expect(listed).toMatchObject({
      kind: 'artifact',
      ref: { mediaType: 'application/json', summary: '400 clips.' },
    });
    expect(JSON.stringify(events).length).toBeLessThan(20_000);
    const page = ofType(events, 'tool.completed')[2]?.payload.output;
    expect(page).toMatchObject({ kind: 'inline' });
    expect(String(page?.kind === 'inline' ? page.value : '')).toMatch(
      /^Bytes 0-64 of \d+\.\n<untrusted source="artifact">\n\{"clips":\[/,
    );
  });

  it('serves a repeat read from the content-hash cache across runs', async () => {
    const h = harness({
      script: turns(
        plan('Count'),
        { toolCalls: [call('clips_countWords', { text: 'one two' })] },
        { text: 'Two.' },
      ),
    });
    const first = unwrap(await h.agent.run(start));
    const second = unwrap(await h.agent.run(start));
    const cached = async (runId: typeof first.runId) =>
      ofType(await h.events(runId), 'tool.completed').map((e) => e.payload.cached);
    expect(await cached(first.runId)).toEqual([false, false]);
    expect(await cached(second.runId)).toEqual([false, true]);
  });
});
