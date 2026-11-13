// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gate demo, headless (P1-G7, P1-G5, P1-H3, P1-I3): "Add my Desktop/Trip
 * folder and tell me what's in the first video", sent through the chat
 * service. Real tools on a temp folder with a video FFmpeg makes in setup:
 * library.addSource (a write, which runs unasked at the default autonomy
 * level), library.listFiles, media.probe, then vision.describeFrame, which
 * asks for upload consent with core's consent card. "Always allow" covers the
 * follow-ups: another upload in the same conversation, and one after a
 * restart, go ahead without asking. After the first exchange the agent's
 * model names the chat. Everything is stored in one library database file.
 *
 * It runs twice: on scripted model clients, and on the recorded model session
 * (real @taalcut/models clients replaying fixtures/gate-demo.cassette.json),
 * the same session the desktop smoke test uses. TAALCUT_RECORD=1 re-records
 * it. Skips without FFmpeg.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, newId, ok, unwrap, type CloudCallSink, type ConversationId } from '@taalcut/core';
import {
  checkTrace,
  consentsService,
  createScriptedModelClient,
  fromCoreEventLog,
  runMessage,
  runMessageIndex,
  type ChatEvent,
} from '@taalcut/agent';
import { detectEncoders, FfmpegNotFound, runFfmpeg, type BinaryResolver } from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';
import type { ModelClient, ModelRequest } from '@taalcut/models';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
  CLOUD_VISION,
  createRecordedGateModels,
  FRAME_DESCRIPTION,
  GATE_AGENT,
  GATE_DEMO_ANSWER,
  GATE_DEMO_ASK,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_FOLLOW_UPS,
  GATE_DEMO_TITLE,
  gateDemoTurn,
  type FollowUp,
  type RecordedGateModels,
} from '../src/index';
import { composeGateDemo } from './compose';

// The run's FFmpeg, checked once before any file started (media's test-support-ffmpeg.ts); the demo's media
// service is handed that answer instead of checking again.
const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'gate demo');
const resolver: BinaryResolver = {
  resolve: async () => (binaries ? ok(binaries) : err(FfmpegNotFound({ binary: 'ffmpeg' }))),
};

/**
 * The demo runs real FFmpeg and ffprobe: setup encodes the clip, and each test probes it and takes frames, two
 * to six processes. On the dev Mac under a full parallel load each takes from a few hundred milliseconds to
 * several seconds (UX2 round 2, beside other lanes' tests at load 25 to 35: 1.5 to 4 s to probe the 2 s clip,
 * against 10 to 20 ms idle), so Vitest's defaults (5 s a test, 10 s a hook) don't tell a hang from a busy
 * machine here. The other suites keep them.
 */
const RUNS_FFMPEG = { timeout: 60_000 };

const usage = { inputTokens: 1200, outputTokens: 80, costUsd: 0.002 };

/** Every tool result the model has seen so far in this run, oldest first. */
function toolResults(request: ModelRequest): string[] {
  return request.messages
    .slice(Math.max(0, runMessageIndex(request.messages)))
    .flatMap((m) => (m.role === 'tool' ? [String(m.content)] : []));
}

type Models = (callLog: CloudCallSink) => { readonly agent: ModelClient; readonly vision: ModelClient };

const scripted: Models = (callLog) => ({
  agent: createScriptedModelClient(
    (request, turn) => {
      // Without tools: the chat's title, after the first exchange.
      if (!request.tools?.length) return { text: GATE_DEMO_TITLE, usage };
      const reply = gateDemoTurn(turn, toolResults(request), runMessage(request));
      return {
        ...(reply.text ? { text: reply.text } : {}),
        ...(reply.reasoning ? { reasoning: reply.reasoning } : {}),
        toolCalls: reply.toolCall ? [{ name: reply.toolCall.name, arguments: reply.toolCall.args }] : [],
        usage,
      };
    },
    { callLog },
  ),
  vision: createScriptedModelClient(
    () => ({
      text: FRAME_DESCRIPTION,
      provider: CLOUD_VISION.provider,
      model: CLOUD_VISION.model,
      usage: { inputTokens: 700, outputTokens: 40, costUsd: 0.0004 },
    }),
    { callLog },
  ),
});

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

const consentCards = (events: readonly { type: string; payload?: unknown }[]) =>
  events.flatMap((e) => {
    if (e.type !== 'agent.card') return [];
    const { card } = e.payload as { card: { type: string; status?: string; approvalId?: string } };
    return card.type === 'consent' ? [card] : [];
  });

describe.skipIf(!binaries).each([
  { source: 'scripted models', agentProvider: 'scripted' },
  { source: 'the recorded model session', agentProvider: GATE_AGENT.provider },
])('the gate demo, headless, on $source', RUNS_FFMPEG, ({ source, agentProvider }) => {
  let root: string;
  let home: string;
  let trip: string;
  let models: Models;
  let recorded: RecordedGateModels | undefined;
  let continued: ReturnType<typeof composeGateDemo> | undefined;
  const conversationId: ConversationId = newId<'Conversation'>();

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-gate-')));
    home = join(root, 'home');
    trip = join(home, 'Desktop', 'Trip');
    mkdirSync(trip, { recursive: true });
    mkdirSync(join(root, 'app-data'));
    if (!binaries) throw new Error('gate demo: the suite ran without FFmpeg');
    const ctx = { binaries };
    const encoders = unwrap(await detectEncoders(ctx));
    const h264 = ['libx264', 'libopenh264', 'h264_videotoolbox', 'mpeg4'].find((n) =>
      encoders.encoders.some((e) => e.name === n),
    );
    const made = await runFfmpeg(ctx, [
      ...['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2'],
      ...['-c:v', h264 ?? 'mpeg4', '-pix_fmt', 'yuv420p', join(trip, 'beach.mov')],
    ]);
    unwrap(made);
    writeFileSync(join(trip, 'notes.txt'), 'not a video');
    recorded =
      source === 'scripted models' ? undefined : createRecordedGateModels(GATE_DEMO_FIXTURES, { home });
    models = recorded ?? scripted;
  }, RUNS_FFMPEG.timeout);
  afterAll(() => {
    continued?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const open = () =>
    composeGateDemo({
      databasePath: join(root, 'library.db'),
      resolver,
      home,
      appData: join(root, 'app-data'),
      models,
    });

  it('adds the folder, probes the first video, asks before uploading a frame, and reports', async () => {
    const demo = open();
    continued = demo;
    const sent = unwrap(
      await demo.chat.send({ conversationId, text: GATE_DEMO_ASK }, { signal: new AbortController().signal }),
    );
    const first = await collect(sent.events);
    // The frame upload waits for consent, whatever the autonomy level.
    expect(first.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'paused' } });
    // Core's consent card: what leaves the Mac (the video the frame comes from), to which provider, three answers.
    expect(first.find((e) => e.type === 'agent.approvalRequested')).toBeUndefined();
    const [asked, ...more] = consentCards(first);
    expect(more).toEqual([]);
    expect(asked).toMatchObject({
      tool: 'vision.describeFrame',
      runId: sent.runId,
      upload: { modules: ['vision'], providers: [CLOUD_VISION.provider], files: [join(trip, 'beach.mov')] },
      options: ['allow-once', 'always-allow', 'deny'],
      status: 'pending',
    });
    expect(
      first.filter((e) => e.type === 'agent.toolFinished').map((e) => [e.payload.tool, e.payload.status]),
    ).toEqual([
      ['library.addSource', 'succeeded'],
      ['library.listFiles', 'succeeded'],
      ['media.probe', 'succeeded'],
    ]);
    expect(first.find((e) => e.type === 'agent.reasoningDelta')).toBeDefined();

    // "Always allow" for vision: this upload goes ahead, and the consent is in Settings.
    const approvalId = (asked as { approvalId?: string } | undefined)?.approvalId ?? '';
    unwrap(
      await demo.chat.decideApproval({ runId: sent.runId, approvalId, decision: 'approve', remember: true }),
    );
    expect(await demo.consents.get('vision')).toMatchObject({
      module: 'vision',
      providers: [CLOUD_VISION.provider],
    });

    const { history } = unwrap(await demo.chat.getConversation(conversationId));
    expect(history.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'succeeded' } });
    const said = history.flatMap((e) => (e.type === 'agent.messageDelta' ? [e.payload.delta] : []));
    expect(said.at(-1)).toBe(GATE_DEMO_ANSWER);
    expect(consentCards(history).map((card) => card.status)).toEqual(['pending', 'approved']);
    expect(
      history
        .filter((e) => e.type === 'agent.reasoningDelta')
        .map((e) => e.payload.delta)
        .join(''),
    ).toBe(gateDemoTurn(0, []).reasoning);

    // Every span is there, with tokens, cost and latency, rebuilt from the run log in the database.
    const trace = unwrap(await demo.agent.trace(sent.runId));
    expect(checkTrace(trace)).toEqual([]);
    const tools = trace.spans.filter((s) => s.kind === 'tool' && !s.attributes.meta);
    expect(tools.map((s) => [s.name, s.status])).toEqual([
      ['library.addSource', 'ok'],
      ['library.listFiles', 'ok'],
      ['media.probe', 'ok'],
      ['vision.describeFrame', 'ok'],
    ]);
    for (const span of [...tools, ...trace.spans.filter((s) => s.kind === 'model')]) {
      expect(span.attributes, span.name).toMatchObject({
        latencyMs: expect.any(Number),
        costUsd: expect.any(Number),
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
      });
    }
    expect(trace.totals).toMatchObject({ modelCalls: 8, toolCalls: 4 });

    // The same trace in the viewer's store, written as the run went.
    const viewed = unwrap(await demo.ports.traces.get({ runId: sent.runId }));
    expect(viewed).toMatchObject({ conversationId, status: 'succeeded', message: GATE_DEMO_ASK, gaps: [] });
    expect(viewed.spans[0]).toMatchObject({ kind: 'run', name: GATE_DEMO_ASK, status: 'ok' });
    expect(viewed.spans.map((s) => s.spanId).sort()).toEqual(trace.spans.map((s) => s.spanId).sort());
    expect(viewed.spans.every((s) => s.status === 'ok' && s.endedAt !== undefined)).toBe(true);
    expect(viewed.spans.filter((s) => s.kind === 'tool' && s.name.includes('.')).map((s) => s.name)).toEqual([
      'library.addSource',
      'library.listFiles',
      'media.probe',
      'vision.describeFrame',
    ]);
    expect(viewed.spans.find((s) => s.kind === 'model')).toMatchObject({
      name: `${agentProvider}/${agentProvider === 'scripted' ? 'script-1' : GATE_AGENT.model}`,
      inputTokens: 1200,
      outputTokens: 80,
      costUsd: expect.any(Number),
    });
    expect(unwrap(await demo.ports.traces.runs())).toMatchObject([
      { runId: sent.runId, modelCalls: 8, complete: true, status: 'succeeded' },
    ]);

    // After the first exchange the chat is named, through the agent's client (the demo has no router model).
    await vi.waitFor(async () =>
      expect(unwrap(await demo.chat.listConversations())).toMatchObject([
        { id: conversationId, title: GATE_DEMO_TITLE },
      ]),
    );

    // Eight run calls and one title call use the agent client; vision has its own upload row.
    const calls = demo.repos.cloudCalls.list();
    expect(calls).toHaveLength(10);
    expect(calls.filter((c) => c.module === 'agent' && c.provider === agentProvider)).toHaveLength(9);
    expect(calls.filter((c) => c.module === 'vision')).toMatchObject([
      { provider: CLOUD_VISION.provider, local: false, runId: sent.runId },
    ]);
    expect(calls.filter((c) => c.module === 'router')).toEqual([]);

    // The source went through the command bus as the agent, with its row in the same database.
    const audit = unwrap(await demo.ports.auditLog.listByProject(null));
    expect(audit).toMatchObject([
      { name: 'library.addSource', source: 'agent', actor: `agent:${sent.runId}` },
    ]);
    expect(demo.repos.sources.list().map((s) => s.rootPath)).toEqual([trip]);
  });

  /** Sends a follow-up and checks it uploaded its frame without asking, on the standing consent. */
  async function followUp(demo: ReturnType<typeof open>, ask: FollowUp, calls: number) {
    const sent = unwrap(
      await demo.chat.send({ conversationId, text: ask.ask }, { signal: new AbortController().signal }),
    );
    const events = await collect(sent.events);
    expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'succeeded' } });
    expect(consentCards(events)).toEqual([]);
    expect(events.find((e) => e.type === 'agent.approvalRequested')).toBeUndefined();
    expect(
      events.filter((e) => e.type === 'agent.toolFinished').map((e) => [e.payload.tool, e.payload.status]),
    ).toEqual([
      ['library.listSources', 'succeeded'],
      ['vision.describeFrame', 'succeeded'],
    ]);
    // The answer streams in pieces: the last message's deltas, joined.
    const deltas = events.flatMap((e) => (e.type === 'agent.messageDelta' ? [e.payload] : []));
    const last = deltas.at(-1)?.messageId;
    expect(deltas.flatMap((d) => (d.messageId === last ? [d.delta] : [])).join('')).toBe(ask.answer);
    // Logged, never silent: the run log has the approval the standing consent gave.
    const log = unwrap(await fromCoreEventLog(demo.ports.eventLog).read(sent.runId));
    expect(log.filter((e) => e.type === 'approval.requested').map((e) => e.payload)).toMatchObject([
      { kind: 'consent', reason: 'standing-consent', standingConsentIds: [expect.any(String)] },
    ]);
    // A new frame: vision called the cloud again, with its CloudCall row.
    await vi.waitFor(() => expect(demo.repos.cloudCalls.list()).toHaveLength(calls));
    const rows = demo.repos.cloudCalls.list();
    expect(rows.every((row) => row.outcome === 'ok')).toBe(true);
    expect(rows.filter((c) => c.module === 'vision' && c.runId === sent.runId)).toHaveLength(1);
  }

  it('uploads another frame in the same conversation without asking again', async () => {
    const demo = continued!;
    // Same service as the desktop: four agent turns, one upload, and the second-exchange title refinement.
    await followUp(demo, GATE_DEMO_FOLLOW_UPS[0], 10 + 6);
    demo.close();
    continued = undefined;
  });

  it('keeps the conversation, the consent and undo and redo across restarts; a revoked consent asks again', async () => {
    const second = open();
    const { history } = unwrap(await second.chat.getConversation(conversationId));
    expect(history[0]).toMatchObject({ type: 'user.message', payload: { text: GATE_DEMO_ASK } });
    expect(history.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'succeeded' } });
    // Named once: the title stays, and nothing asks for another.
    expect(unwrap(await second.chat.listConversations())).toMatchObject([
      { id: conversationId, title: GATE_DEMO_TITLE },
    ]);
    expect(await second.consents.get('vision')).toBeDefined();
    // "Always allow" outlives the restart: the next upload doesn't ask either.
    await followUp(second, GATE_DEMO_FOLLOW_UPS[1], 10 + 6 + 5);

    // Taken back (appContract.consents, for Settings): the next upload asks again, and Allow once keeps nothing.
    const consents = consentsService(second.consents);
    expect(unwrap(await consents.list())).toMatchObject([
      { module: 'vision', providers: [CLOUD_VISION.provider] },
    ]);
    expect(unwrap(await consents.revoke({ module: 'vision' }))).toEqual({ module: 'vision', revoked: true });
    const revoked = GATE_DEMO_FOLLOW_UPS[2];
    const asking = unwrap(
      await second.chat.send({ conversationId, text: revoked.ask }, { signal: new AbortController().signal }),
    );
    const asked = await collect(asking.events);
    expect(asked.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'paused' } });
    const [card] = consentCards(asked);
    expect(card).toMatchObject({ status: 'pending' });
    unwrap(
      await second.chat.decideApproval({
        runId: asking.runId,
        approvalId: card?.approvalId ?? '',
        decision: 'approve',
      }),
    );
    const after = unwrap(await second.chat.getConversation(conversationId)).history;
    expect(after.at(-1)).toMatchObject({
      type: 'agent.runFinished',
      payload: { runId: asking.runId, status: 'succeeded' },
    });
    const said = after.flatMap((e) => (e.type === 'agent.messageDelta' ? [e.payload.delta] : []));
    expect(said.at(-1)).toBe(revoked.answer);
    expect(unwrap(await consents.list())).toEqual([]);
    expect(second.repos.cloudCalls.list()).toHaveLength(10 + 6 + 5 + 5);
    const id = second.repos.sources.list()[0]!.id;
    unwrap(await second.bus.undo(null, { source: 'ui', actor: 'user' }));
    expect(second.repos.sources.list()).toEqual([]);
    second.close();

    const third = open();
    // EDT1: the agent's command is its turn's history step.
    expect(unwrap(await third.bus.history(null))).toEqual({
      undo: null,
      redo: 'library.addSource',
      redoGroup: expect.stringMatching(/^turn:/),
    });
    unwrap(await third.bus.redo(null, { source: 'ui', actor: 'user' }));
    expect(third.repos.sources.list()).toMatchObject([{ id, rootPath: trip }]);
    third.close();

    if (recorded?.cassette.mode === 'record') await recorded.cassette.save();
    else if (recorded) expect([recorded.cassette.misses(), recorded.cassette.unused()]).toEqual([[], 0]);
  });
});
