// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-GFX's contract on compositions (HFW1 retire): a graphic the Designer made is a proposal on the timeline until
 * the person uses it, with the words it was made from; a graphic has a size of its own; graphics.edit sets its
 * design's values; and the motion graphic card knows the run that made it. Made-up words.
 */
import { describe, expect, it } from 'vitest';
import {
  GRAPHIC_PROPOSAL_DESIGNS,
  GRAPHIC_SCALE_LIMITS,
  graphicItemSchema,
  graphicProposalSchema,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  newId,
  parseCard,
  RationalTime,
} from '../src';
import { COMPOSITION } from './helpers/hfw1';

const rate = { num: 30, den: 1 };
const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const itemId = newId<'TimelineItem'>();
const item = {
  type: 'graphic',
  id: itemId,
  anchor: { kind: 'time', at: RationalTime.of(30, rate) },
  start: RationalTime.of(30, rate),
  duration: RationalTime.of(90, rate),
  placement: 'bottom',
  styleKey: 'graphic',
  language: 'en',
  origin: 'agent',
  composition: { id: COMPOSITION.id, hash: COMPOSITION.hash, params: { message: 'Asha Rao' } },
} as const;
const designed = { request: 'a lower third with my name', design: 'designed', createdAt: 1 } as const;

describe('EDT1-GFX: proposed graphics (contract)', () => {
  it('a graphic with neither is part of the video at its own size', () => {
    const parsed = graphicItemSchema.parse(item);
    expect(parsed.proposal).toBeUndefined();
    expect(parsed.scale).toBeUndefined();
  });

  it('a proposal is designed, with the words it was made from', () => {
    expect(GRAPHIC_PROPOSAL_DESIGNS).toEqual(['designed']);
    expect(graphicItemSchema.parse({ ...item, proposal: designed }).proposal).toEqual(designed);
    expect(graphicProposalSchema.safeParse({ ...designed, design: 'kit' }).success).toBe(false);
    expect(graphicProposalSchema.parse({ ...designed, kitReason: 'onDevice' })).toEqual(designed);
    expect(graphicProposalSchema.safeParse({ ...designed, request: ' ' }).success).toBe(false);
    expect(graphicProposalSchema.safeParse({ ...designed, request: 'x'.repeat(501) }).success).toBe(false);
  });

  it('a graphic is a half to twice its own size', () => {
    expect(GRAPHIC_SCALE_LIMITS).toEqual({ min: 0.5, max: 2 });
    expect(graphicItemSchema.parse({ ...item, scale: 0.8 }).scale).toBe(0.8);
    expect(graphicItemSchema.safeParse({ ...item, scale: 0.4 }).success).toBe(false);
    expect(graphicItemSchema.safeParse({ ...item, scale: 2.5 }).success).toBe(false);
  });

  it('graphics.useProposal names the proposed graphic', () => {
    const use = graphicsCommandPayloads[GRAPHICS_COMMANDS.useProposal];
    expect(GRAPHICS_COMMANDS.useProposal).toBe('graphics.useProposal');
    expect(use.safeParse({ projectId, timelineId, itemId }).success).toBe(true);
    expect(use.safeParse({ projectId, timelineId }).success).toBe(false);
  });

  it('graphics.edit sets a size and its design’s values, and takes no kit fields', () => {
    const edit = graphicsCommandPayloads[GRAPHICS_COMMANDS.edit];
    const parsed = edit.parse({ projectId, timelineId, itemId, scale: 0.8, params: { fill: '#112233' } });
    expect(parsed).toMatchObject({ scale: 0.8, params: { fill: '#112233' } });
    expect(edit.safeParse({ projectId, timelineId, itemId, scale: 3 }).success).toBe(false);
    expect(edit.parse({ projectId, timelineId, itemId, fields: { text: 'Made-up' } })).not.toHaveProperty(
      'fields',
    );
    expect(Object.keys(GRAPHICS_COMMANDS)).not.toEqual(expect.arrayContaining(['add']));
  });

  it('the motion graphic card may carry the run that made it', () => {
    const card = {
      type: 'motionGraphic',
      id: 'tool:1',
      version: 1,
      projectId,
      timelineId,
      itemId,
      composition: { id: COMPOSITION.id, name: 'Name badge' },
      start: item.start,
      duration: item.duration,
      unmatched: [],
    };
    expect(parseCard(card).ok).toBe(true);
    const { composition: _composition, ...unnamed } = card;
    expect(parseCard({ ...unnamed, kind: 'lowerThird', fields: { title: 'Asha Rao' } }).ok).toBe(false);
    const runId = newId<'AgentRun'>();
    const withRun = parseCard({ ...card, runId });
    expect(withRun.ok && withRun.value.type === 'motionGraphic' && withRun.value.runId).toBe(runId);
  });
});
