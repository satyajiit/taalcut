// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's cards and answers (round P3-1): their limits, the optional fields Phase 2 cards parse without, the
 * gapFix and rateLimit answers, and reference pointers on a message.
 */
import { describe, expect, it } from 'vitest';
import {
  chatContract,
  GAP_FIX_KINDS,
  newId,
  parseCard,
  questionAnswerSchema,
  referencePointerSchema,
  SKILL_QUESTIONS,
  unwrap,
} from '@taalcut/core';
import { COST_ESTIMATE_V2, PHASE2_CARDS, runId } from './helpers/card-fixtures';
import { at, span } from './helpers/documents';
import { inputOf } from './helpers/phase3';
import { batchId, PHASE3_CARDS } from './helpers/phase3-cards';

const approval = {
  type: 'approval',
  version: 1,
  id: 'approval-mcp',
  runId,
  approvalId: 'ap-mcp',
  tool: 'render.export',
  sideEffect: 'external',
  summary: 'Export the trip video',
  status: 'pending',
} as const;

describe('changed Phase 2 cards', () => {
  it('names an external agent on an approval, and parses one without', () => {
    expect(unwrap(parseCard(approval))).toEqual(approval);
    const asked = {
      ...approval,
      requester: { kind: 'mcp', sessionId: newId<'McpSession'>(), name: 'Claude Code' },
    };
    expect(unwrap(parseCard(asked))).toEqual(asked);
    expect(parseCard({ ...asked, requester: { ...asked.requester, kind: 'agent' } }).ok).toBe(false);
    expect(parseCard({ ...asked, requester: { ...asked.requester, name: 'x'.repeat(61) } }).ok).toBe(false);
  });

  it('adds Content Credentials and the batch form to the export approval', () => {
    const card = {
      ...PHASE2_CARDS.exportApproval,
      credentials: { add: false, sourcesWithCredentials: 2, disclosures: ['tiktok'] },
      batch: { batchId, items: 4 },
    };
    expect(unwrap(parseCard(card))).toEqual(card);
    expect(parseCard({ ...card, batch: { batchId, items: 51 } }).ok).toBe(false);
    expect(parseCard({ ...card, credentials: { ...card.credentials, disclosures: ['vimeo'] } }).ok).toBe(
      false,
    );
  });

  it('shows billed units and estimates on cost lines', () => {
    const line = { ...COST_ESTIMATE_V2.lines[0], billed: { unit: 'image', quantity: 4 }, estimated: true };
    const card = { ...COST_ESTIMATE_V2, lines: [line] };
    expect(unwrap(parseCard(card))).toEqual(card);
    expect(parseCard({ ...card, lines: [{ ...line, billed: { unit: 'pixel', quantity: 4 } }] }).ok).toBe(
      false,
    );
  });
});

describe('new cards', () => {
  it('keeps the rate-limit card to https billing pages and six options', () => {
    const card = PHASE3_CARDS.rateLimit;
    expect(parseCard({ ...card, billingUrl: 'http://billing.example.com' }).ok).toBe(false);
    const option = { provider: 'taalcut', model: 'qwen', local: true };
    expect(parseCard({ ...card, options: Array(7).fill(option) }).ok).toBe(false);
    const switched = {
      ...card,
      status: 'switched',
      to: { ...option },
      extra: { currency: 'USD', micros: 2 },
    };
    expect(unwrap(parseCard(switched))).toEqual(switched);
  });

  it('needs a gap with at least one fix, and fixes from the known kinds', () => {
    const card = PHASE3_CARDS.gapFix;
    const gap = card.gaps[0];
    if (!gap) throw new Error('fixture has a gap');
    expect(parseCard({ ...card, gaps: [] }).ok).toBe(false);
    expect(parseCard({ ...card, gaps: [{ ...gap, options: [] }] }).ok).toBe(false);
    expect(parseCard({ ...card, gaps: [{ ...gap, options: [{ kind: 'stock', query: ' ' }] }] }).ok).toBe(
      false,
    );
    expect(
      parseCard({ ...card, gaps: [{ ...gap, unavailable: [{ kind: 'paint', reason: 'localOnly' }] }] }).ok,
    ).toBe(false);
    expect(GAP_FIX_KINDS).toEqual([
      'film',
      'generate',
      'stock',
      'drop',
      'swap',
      'keep',
      'addClips',
      'borrow',
      'reuse',
    ]);
    expect(SKILL_QUESTIONS).toContain('gapFix');
  });

  it('carries a weak pick with up to three swap candidates, each with its description and fit (FIX-GAPS)', () => {
    const card = PHASE3_CARDS.gapFix;
    const gap = card.gaps[0];
    if (!gap) throw new Error('fixture has a gap');
    const shot = (fit: number) => ({
      assetId: newId<'Asset'>(),
      shotId: newId<'Shot'>(),
      description: 'A street at night',
      fit,
    });
    const weak = { pick: shot(0.4), confidence: 0.35, betterFit: true };
    const swap = { kind: 'swap', candidates: [shot(0.9), shot(0.7), shot(0.6)] };
    const parsed = parseCard({
      ...card,
      gaps: [{ ...gap, weak, options: [swap, { kind: 'keep' }, { kind: 'film' }], outcome: 'swapped' }],
    });
    expect(parsed.ok).toBe(true);
    const four = { ...swap, candidates: [...swap.candidates, shot(0.5)] };
    expect(parseCard({ ...card, gaps: [{ ...gap, weak, options: [four] }] }).ok).toBe(false);
    expect(parseCard({ ...card, gaps: [{ ...gap, weak: { ...weak, pick: shot(1.2) } }] }).ok).toBe(false);
  });

  it('applies only known caption presets in a batch and lists at most fifty videos', () => {
    const card = PHASE3_CARDS.styleBatch;
    const preset = { ...card, apply: { kind: 'captionPreset', presetId: 'bold' } };
    expect(unwrap(parseCard(preset))).toEqual(preset);
    expect(parseCard({ ...card, apply: { kind: 'captionPreset', presetId: 'comic' } }).ok).toBe(false);
    expect(parseCard({ ...card, applied: Array(51).fill(card.applied[0]) }).ok).toBe(false);
  });

  it('keeps media cards to their limits', () => {
    expect(parseCard({ ...PHASE3_CARDS.imageTakes, takes: [] }).ok).toBe(false);
    expect(parseCard({ ...PHASE3_CARDS.voiceConsent, status: 'uploading' }).ok).toBe(false);
    expect(
      parseCard({ ...PHASE3_CARDS.motionGraphic, duration: { value: 0, rate: { num: 30, den: 1 } } }).ok,
    ).toBe(false);
    expect(
      parseCard({ ...PHASE3_CARDS.renderBatch, items: Array(51).fill(PHASE3_CARDS.renderBatch.items[0]) }).ok,
    ).toBe(false);
    expect(parseCard({ ...PHASE3_CARDS.voiceover, quality: 'studio' }).ok).toBe(false);
    expect(parseCard({ ...PHASE3_CARDS.variantsCompare, asked: 6 }).ok).toBe(false);
    expect(parseCard({ ...PHASE3_CARDS.cleanupPlan, status: 'undone' }).ok).toBe(false);
    expect(parseCard({ ...PHASE3_CARDS.hubResults, sort: 'popular' }).ok).toBe(false);
  });
});

describe('answers', () => {
  it('answers gap fixes per gap, and declines with none', () => {
    const gapId = newId<'TimelineItem'>();
    expect(questionAnswerSchema.parse({ kind: 'gapFix', fixes: [{ gapId, fix: 'generate' }] })).toEqual({
      kind: 'gapFix',
      fixes: [{ gapId, fix: 'generate' }],
    });
    expect(questionAnswerSchema.parse({ kind: 'gapFix', fixes: [] })).toEqual({ kind: 'gapFix', fixes: [] });
    expect(questionAnswerSchema.safeParse({ kind: 'gapFix', fixes: [{ gapId, fix: 'paint' }] }).success).toBe(
      false,
    );
  });

  it('names the model with a switch, and only with a switch', () => {
    const model = { provider: 'anthropic', model: 'claude-sonnet-5' };
    expect(questionAnswerSchema.parse({ kind: 'rateLimit', choice: 'switch', model })).toMatchObject({
      model,
    });
    expect(questionAnswerSchema.parse({ kind: 'rateLimit', choice: 'wait' })).toEqual({
      kind: 'rateLimit',
      choice: 'wait',
    });
    expect(questionAnswerSchema.safeParse({ kind: 'rateLimit', choice: 'switch' }).success).toBe(false);
    expect(questionAnswerSchema.safeParse({ kind: 'rateLimit', choice: 'stop', model }).success).toBe(false);
  });
});

describe('reference pointers', () => {
  const pointer = {
    said: 'at 0:04',
    basis: 'template',
    kind: 'range',
    templateId: newId<'Template'>(),
    timelineId: null,
    slotId: null,
    slotNumber: null,
    clipId: null,
    range: span(120, 15),
  };

  it('keeps what the words pointed at, with a range that runs forward', () => {
    expect(referencePointerSchema.parse(pointer)).toEqual(pointer);
    expect(referencePointerSchema.safeParse({ ...pointer, range: span(-1, 15) }).success).toBe(false);
    expect(
      referencePointerSchema.safeParse({ ...pointer, range: { start: at(0), duration: at(-1) } }).success,
    ).toBe(false);
    expect(referencePointerSchema.safeParse({ ...pointer, said: 'x'.repeat(81) }).success).toBe(false);
  });

  it('travels on a sent message, at most ten', () => {
    const message = { conversationId: newId<'Conversation'>(), text: 'cut here', pointers: [pointer] };
    const sent = inputOf(chatContract.send, message);
    expect(sent.success && sent.data).toMatchObject({ pointers: [pointer] });
    expect(inputOf(chatContract.send, { ...message, pointers: Array(11).fill(pointer) }).success).toBe(false);
  });
});
