// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Saved progress (LRN1-CTX, SPEC "Saved progress"): once a `savesProgress` tool's call has succeeded, the turns
 * before it in the same stretch are one note, so a job done a page at a time sends the same prompt size on page 10
 * as on page 2. Replay builds the same prompts; a run whose tools save nothing is unchanged byte for byte.
 */
import { defineTool, defineToolModule, NO_TOOL_RETRY, ok, unwrap } from '@taalcut/core';
import {
  buildMessages,
  CONTROL_PREFIX,
  foldEvents,
  type ModelScript,
  type RunState,
  type ScriptedReply,
} from '@taalcut/agent';
import type { ChatMessage } from '@taalcut/models';
import type { ToolRegistry } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { renderToolMessage } from '../src/messages';
import { call, harness, plan } from './support/harness';

const PAGES = 10;
const pageText = (page: number) => `Page ${page}: ${'the quick brown fox '.repeat(100)}`;

function pager(saves: boolean) {
  const readPage = defineTool({
    name: 'pager.readPage',
    version: '1.0.0',
    description: 'Reads one page of the book.',
    input: z.object({ page: z.int().min(0) }),
    output: z.object({ text: z.string() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async ({ page }) => ok({ text: pageText(page) }),
  });
  const savePage = defineTool({
    name: 'pager.savePage',
    version: '1.0.0',
    description: "Stores a page's notes; returns how many pages are stored and the next one to read.",
    input: z.object({ page: z.int().min(0), notes: z.string() }),
    output: z.object({ saved: z.int(), next: z.int() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    ...(saves ? { savesProgress: true } : {}),
    run: async ({ page }) => ok({ saved: page + 1, next: page + 1 }),
  });
  return defineToolModule({ id: 'pager', tools: [readPage, savePage] });
}

/**
 * One reply per request, in order; the last repeats. The scripted client's own turn count reads the prompt, which
 * saving shortens, so this script counts requests instead.
 */
function inOrder(replies: readonly ScriptedReply[]): ModelScript {
  let sent = 0;
  const last = replies.at(-1) ?? { text: '' };
  return () => replies[sent++] ?? last;
}

async function readBook(saves: boolean) {
  const replies: ScriptedReply[] = [
    plan('Read the book'),
    ...Array.from({ length: PAGES }, (_, page) => [
      { toolCalls: [{ id: `read-${page}`, ...call('pager_readPage', { page }) }] },
      {
        toolCalls: [
          { id: `save-${page}`, ...call('pager_savePage', { page, notes: `notes on page ${page}` }) },
        ],
      },
    ]).flat(),
    { text: 'Read it.' },
  ];
  const h = harness({
    script: inOrder(replies),
    modules: [pager(saves)],
    settings: { loop: { maxTurnsPerStep: 3 * PAGES, maxTurns: 3 * PAGES } },
  });
  const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Read the book to me.' }));
  expect(outcome.status).toBe('completed');
  const size = (index: number) => JSON.stringify(h.models.requests[index]?.messages).length;
  // The request that writes page k's notes: plan, then two turns a page.
  const atSave = Array.from({ length: PAGES }, (_, page) => size(2 + 2 * page));
  const state = foldEvents(outcome.runId, await h.events(outcome.runId));
  return { h, runId: outcome.runId, atSave, state };
}

/** The list as built before saved progress: every turn, every result, in order. */
function everyTurn(state: RunState, registry: ToolRegistry): ChatMessage[] {
  return state.transcript.flatMap((item): ChatMessage[] => {
    if (item.kind === 'user') return [{ role: 'user', content: item.text }];
    if (item.kind === 'control') return [{ role: 'user', content: `${CONTROL_PREFIX} ${item.text}` }];
    return [
      item.message,
      ...item.toolCallIds.flatMap((id): ChatMessage[] => {
        const toolCall = state.toolCalls[id];
        if (!toolCall?.outcome) return [];
        const { content, isError } = renderToolMessage(toolCall, registry);
        return [
          {
            role: 'tool',
            toolCallId: toolCall.requested.modelToolCallId,
            toolName: toolCall.requested.callName,
            content,
            ...(isError ? { isError } : {}),
          },
        ];
      }),
    ];
  });
}

describe('saved progress', () => {
  it('keeps the prompt the same size as pages grow, once each page is saved', async () => {
    const { atSave, h } = await readBook(true);
    // From the second page on, the earlier pages are one note: the prompt doesn't grow.
    const later = atSave.slice(1);
    expect(Math.max(...later) - Math.min(...later)).toBeLessThan(40);
    expect(Math.max(...later)).toBeLessThan(3 * pageText(0).length);
    const last = h.models.requests.at(-1)?.messages ?? [];
    const notes = last.flatMap((m) =>
      m.role === 'user' && String(m.content).includes('pager.savePage saved') ? [String(m.content)] : [],
    );
    expect(notes).toHaveLength(1);
    // The plan's turn, every page read and every save but the last: one call each.
    expect(notes[0]).toContain(`this step's ${1 + PAGES + (PAGES - 1)} earlier turns`);
    expect(notes[0]).toContain(`their ${1 + PAGES + (PAGES - 1)} tool calls`);
    // Without saving, each page stays: the prompt grows by about a page a page.
    const plain = await readBook(false);
    const [atLast = 0, atSecond = 0] = [plain.atSave[PAGES - 1], plain.atSave[1]];
    expect(atLast).toBeGreaterThan(atSecond + (PAGES - 3) * pageText(0).length);
  });

  it('builds the same prompts on replay', async () => {
    const { h, runId } = await readBook(true);
    expect(unwrap(await h.agent.replay(runId))).toMatchObject({ promptDrift: 0, status: 'completed' });
  });

  it('leaves a run whose tools save nothing unchanged, byte for byte', async () => {
    const plain = await readBook(false);
    expect(buildMessages(plain.state, plain.h.registry)).toEqual(everyTurn(plain.state, plain.h.registry));
    const saved = await readBook(true);
    expect(buildMessages(saved.state, saved.h.registry)).not.toEqual(
      everyTurn(saved.state, saved.h.registry),
    );
  });
});
