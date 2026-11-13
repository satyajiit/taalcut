// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: answering the gaps question in the chat. The words become the card's answer: "I added a clip, try again"
 * is Add more clips; "use the walkway clip for the first shot" is the clip the card offered that shot; "drop shot 3",
 * "film it", "go ahead" take the card's fixes; a gap the words don't name keeps its proposed fix. Words that answer
 * nothing go on as a message of their own. Through the chat service, the answer carries the waiting run on instead of
 * starting another. All made-up data.
 */
import { newId, unwrap, type Card } from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  gapReply,
  newEvent,
  type ChatEvent,
  type GapsJoinData,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { ofType } from '../support/harness';
import { gapHarness, latestGapData } from './gap-harness';
import { waitingGapQuestion } from '../../src/chat-pending';

const asset = () => newId<'Asset'>();
const candidate = (description: string) => ({ assetId: asset(), shotId: null, description, fit: 0.7 });

/** A card of three open gaps: an unsure opening (a swap, a borrow), shot 3 empty (a reuse), shot 5 unsure. */
function card() {
  const walkway = candidate('A long walk down a lit walkway');
  const phone = {
    ...candidate('Someone checks a phone on a bench'),
    from: { gapId: 'g4', number: 4, fit: 0.3 },
  };
  const instead = candidate('A neon sign over a shop door');
  const reuse = {
    ...candidate('A tram passes the market'),
    usedIn: 2,
    sourceStart: { value: 300, rate: { num: 30, den: 1 } },
  };
  const row = (gapId: string, number: number, state: 'empty' | 'weak', fix: string, fixes: string[]) => ({
    timelineId: 't1',
    gapId,
    slotId: null,
    number,
    state,
    intent: '',
    fixes,
    fix,
  });
  const gap = (number: number, state: 'empty' | 'weak', options: unknown[], fix: string) => {
    const kinds = (options as { kind: string }[]).map((o) => o.kind);
    return {
      view: { gapId: `g${number}`, number, options },
      row: row(`g${number}`, number, state, fix, kinds),
    };
  };
  const data = {
    timelines: [
      {
        timelineId: 't1',
        projectId: 'p1',
        revision: 2,
        summary: { shots: 5, filled: 4, empty: 1, unsure: 2 },
      },
    ],
    gaps: [
      gap(
        1,
        'weak',
        [
          { kind: 'swap', candidates: [walkway] },
          { kind: 'keep' },
          { kind: 'borrow', candidates: [{ ...phone, instead }] },
          { kind: 'addClips' },
          { kind: 'film' },
          { kind: 'drop' },
        ],
        'keep',
      ),
      gap(
        3,
        'empty',
        [{ kind: 'reuse', candidates: [reuse] }, { kind: 'addClips' }, { kind: 'film' }, { kind: 'drop' }],
        'drop',
      ),
      gap(5, 'weak', [{ kind: 'keep' }, { kind: 'addClips' }, { kind: 'film' }, { kind: 'drop' }], 'keep'),
    ],
  } as unknown as GapsJoinData;
  return { data, walkway, phone, reuse };
}

const fixes = (answer: ReturnType<typeof gapReply>) => answer?.map((a) => [a.gapId, a.fix]);

describe('an answer in the chat (FIX-ASK)', () => {
  it('"I added a clip, try again" asks every gap to wait for the new clips', () => {
    const { data } = card();
    for (const words of ['I added a clip, try again', 'Just imported more footage', 'try again'])
      expect(fixes(gapReply(words, data))).toEqual([
        ['g1', 'addClips'],
        ['g3', 'addClips'],
        ['g5', 'addClips'],
      ]);
    expect(fixes(gapReply('I added a clip for shot 3', data))).toEqual([
      ['g1', 'keep'],
      ['g3', 'addClips'],
      ['g5', 'keep'],
    ]);
  });

  it('"use the walkway clip for the first shot" takes the clip the card offered the opening', () => {
    const { data, walkway, phone, reuse } = card();
    const answer = gapReply('Use the walkway clip for the first shot', data);
    expect(answer?.[0]).toEqual({
      gapId: 'g1',
      fix: 'swap',
      swapTo: { assetId: walkway.assetId, shotId: null },
    });
    expect(fixes(answer)?.slice(1)).toEqual([
      ['g3', 'drop'],
      ['g5', 'keep'],
    ]);
    expect(gapReply('put the phone clip in the opening', data)?.[0]).toMatchObject({
      fix: 'borrow',
      swapTo: { assetId: phone.assetId },
    });
    expect(gapReply('use another part of the tram clip', data)?.[1]).toMatchObject({
      gapId: 'g3',
      fix: 'reuse',
      swapTo: { assetId: reuse.assetId },
    });
  });

  it('takes worded fixes for the shots named, and the card’s own fixes on a yes', () => {
    const { data } = card();
    expect(fixes(gapReply('drop shot 3', data))).toEqual([
      ['g1', 'keep'],
      ['g3', 'drop'],
      ['g5', 'keep'],
    ]);
    expect(fixes(gapReply("I'll film the last one", data))).toEqual([
      ['g1', 'keep'],
      ['g3', 'drop'],
      ['g5', 'film'],
    ]);
    expect(fixes(gapReply('Go ahead', data))).toEqual([
      ['g1', 'keep'],
      ['g3', 'drop'],
      ['g5', 'keep'],
    ]);
  });

  it('answers nothing it can’t tie to the card', () => {
    const { data } = card();
    expect(gapReply('make the music louder', data)).toBeUndefined();
    expect(gapReply('drop shot 2', data)).toBeUndefined(); // shot 2 has its clip
    expect(gapReply('keep shot 3', data)).toBeUndefined(); // an empty shot has nothing to keep
    expect(gapReply('use the beach clip for the first shot', data)).toBeUndefined();
  });
});

async function collect(events: AsyncIterable<ChatEvent>) {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}
const gapCards = (events: readonly ChatEvent[]) =>
  events.flatMap((e) =>
    e.type === 'agent.card' && e.payload.card.type === 'gapFix' ? [e.payload.card] : [],
  ) as Extract<Card, { type: 'gapFix' }>[];

describe('through the chat service', () => {
  it('a late card does not expose the unanswered gaps of a cancelled run', async () => {
    const h = gapHarness({ plan: ['ok', 'ok', 'empty', 'ok', 'ok'], localOnly: true });
    const runId = unwrap(
      await h.agent.start({
        conversationId: newId<'Conversation'>(),
        message: 'Make a video with my template',
        start: { path: 'reference', reference: { kind: 'link', url: 'https://example.com/reel' } },
      }),
    );
    unwrap(await h.agent.wait(runId));
    const log = await h.events(runId);
    expect(waitingGapQuestion(log)).toBeDefined();
    const card = log.find((event) => event.type === 'card.sent')!;
    const cancelled = { ...newEvent('run.cancelled', {}, 2), runId, seq: log.length };
    expect(waitingGapQuestion([...log, cancelled, { ...card, seq: log.length + 1 }])).toBeUndefined();
  });

  it('a reply that answers the waiting gaps question carries that run on; one that doesn’t starts its own', async () => {
    const h = gapHarness({ plan: ['ok', 'ok', 'empty', 'ok', 'ok'], localOnly: true });
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const signal = new AbortController().signal;
    const conversationId = newId<'Conversation'>();
    const first = unwrap(
      await chat.send(
        {
          conversationId,
          text: 'Make a video with my template',
          start: {
            path: 'reference',
            reference: { kind: 'link', url: 'https://www.instagram.com/reel/MADEUP7/' },
          },
        },
        { signal },
      ),
    );
    const asked = await collect(first.events);
    expect(gapCards(asked).find((c) => c.asking)).toBeDefined();
    const gapId = latestGapData(await h.events(first.runId))!.gaps[0]!.view.gapId;

    const reply = unwrap(await chat.send({ conversationId, text: 'drop shot 3' }, { signal }));
    expect(reply.runId).toBe(first.runId);
    const carried = await collect(reply.events);
    expect(carried.some((e) => e.type === 'agent.card' && e.payload.card.type === 'exportApproval')).toBe(
      true,
    );
    const events = await h.events(first.runId);
    const granted = ofType(events, 'approval.granted').at(0);
    expect(granted?.payload.answer).toEqual({ kind: 'gapFix', fixes: [{ gapId, fix: 'drop' }] });
    expect(h.gaps.calls).toEqual(['timeline.dropSlot']);

    // The export waits now, not the gaps question: these words are a message of their own.
    const other = unwrap(await chat.send({ conversationId, text: 'drop shot 3' }, { signal }));
    expect(other.runId).not.toBe(first.runId);
    await collect(other.events);
  });
});
