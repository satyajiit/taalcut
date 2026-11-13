// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Round P3-3 (P3-V15): what a message's words pointed at shows as chips on it while the run is live, from the run's
// `agent.runStarted`, as the stored message shows them after a reload; one the agent couldn't place says so.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { newId, RationalTime, TimeRange, type ChatHistoryEvent, type ReferencePointer } from '@taalcut/core';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { replay, type TranscriptItem } from '../src/chat/transcript';
import { TranscriptView } from '../src/chat/transcript-view';
import { activateLocale } from '../src/i18n/i18n';

const RATE = { num: 30, den: 1 };
const conversationId = newId<'Conversation'>();
const runId = newId<'AgentRun'>();
const messageId = newId<'Message'>();
const templateId = newId<'Template'>();
const timelineId = newId<'Timeline'>();

const pointer = (extra: Partial<ReferencePointer>): ReferencePointer => ({
  said: 'at 0:04',
  basis: 'template',
  kind: 'slot',
  templateId,
  timelineId: null,
  slotId: newId<'TemplateSlot'>(),
  slotNumber: 3,
  clipId: null,
  range: TimeRange.of(RationalTime.of(120, RATE), RationalTime.of(60, RATE)),
  ...extra,
});
const SLOT = pointer({});
const CUT = pointer({
  said: 'the transition at 0:08',
  kind: 'cut',
  range: TimeRange.of(RationalTime.of(240, RATE), RationalTime.of(0, RATE)),
});
const CLIP = pointer({
  said: 'the second shot',
  basis: 'timeline',
  kind: 'clip',
  templateId: null,
  timelineId,
  slotNumber: 2,
  clipId: newId<'TimelineItem'>(),
  range: TimeRange.of(RationalTime.of(360, RATE), RationalTime.of(90, RATE)),
});
const LOST = pointer({ said: 'slot 9', kind: 'unresolved', slotId: null, slotNumber: null, range: null });

const sent = (at: number, pointers?: readonly ReferencePointer[]): ChatHistoryEvent => ({
  type: 'user.message',
  at,
  payload: {
    messageId,
    conversationId,
    text: 'copy the transition at 0:08',
    ...(pointers ? { pointers: [...pointers] } : {}),
  },
});
const started = (at: number, pointers?: readonly ReferencePointer[]): ChatHistoryEvent => ({
  type: 'agent.runStarted',
  at,
  payload: { runId, conversationId, ...(pointers ? { pointers: [...pointers] } : {}) },
});
const userItem = (items: readonly TranscriptItem[]) => items.find((item) => item.kind === 'user');

describe('pointers on the live message', () => {
  it('the run’s start puts its pointers on the message that started it', () => {
    const live = replay([sent(1), started(2, [SLOT, CUT])]);
    const message = userItem(live.items);
    expect(message?.kind === 'user' && message.pointers).toEqual([SLOT, CUT]);
  });

  it('a stored message keeps its own pointers; the run’s start doesn’t add them twice', () => {
    const history = replay([sent(1, [CLIP]), started(2, [CLIP])]);
    const message = userItem(history.items);
    expect(message?.kind === 'user' && message.pointers).toEqual([CLIP]);
  });

  it('a run without pointers, or with no message before it, changes no message', () => {
    expect(userItem(replay([sent(1), started(2)]).items)).not.toHaveProperty('pointers');
    expect(replay([started(2, [SLOT])]).items).toEqual([]);
  });
});

describe('pointer chips', () => {
  beforeAll(() => activateLocale('en'));

  it('show each place in words and time above the words, and one not found as said', () => {
    const items = replay([sent(1), started(2, [SLOT, CUT, CLIP, LOST])]).items;
    render(
      <I18nProvider i18n={i18n}>
        <TranscriptView items={items} />
      </I18nProvider>,
    );
    const chips = [...document.querySelectorAll('[data-slot="pointer-chip"]')];
    expect(chips.map((chip) => chip.getAttribute('data-kind'))).toEqual([
      'slot',
      'cut',
      'clip',
      'unresolved',
    ]);
    expect(chips[0]?.textContent).toMatch(/^Reference · Slot 3 · 0?0:04$/);
    expect(chips[1]?.textContent).toMatch(/^Reference · Cut at 0?0:08$/);
    expect(chips[2]?.textContent).toMatch(/^Clip 2 · 0?0:12$/);
    expect(chips[3]?.textContent).toBe('Not found: slot 9');
    // The words as written are never translated; the rest is the app's.
    expect(chips[3]?.querySelector('[translate="no"]')?.textContent).toBe('slot 9');
    // Above the message's words, inside it.
    const message = screen.getByText('copy the transition at 0:08').closest('[data-slot="chat-message"]');
    expect(message?.contains(chips[0] ?? null)).toBe(true);
  });
});
