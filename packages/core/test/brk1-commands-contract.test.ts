// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** BRK1-CMD's contract: the review's six commands, templates.proposeEdits and the kept reel's URL. */
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  CUT_SNAPS,
  FrameRate,
  MAX_PROPOSALS,
  newId,
  ok,
  PROPOSAL_COMMANDS,
  proposalCommand,
  TEMPLATE_COMMANDS as N,
  TEMPLATE_REEL_KEY_PATTERN,
  templateCommandPayloads as P,
  templateProposalSchema,
  templateProposalsSchema,
  templateProposeEditsInputSchema,
  templateReelUrl,
  templatesContract,
  templatesRouter,
  TemplateBudgetReached,
  TemplateCutOutOfRange,
  TemplateDoubtNotFound,
  TemplateFirstSlotCut,
  TemplateOverlayNotFound,
  TemplateProposalsUnreadable,
  serveRpc,
  type TemplateProposals,
  type TemplatesService,
} from '@taalcut/core';
import { at, referenceTemplate } from './helpers/documents';
import { channel } from './helpers/ports';

const template = referenceTemplate();
const slotId = template.slots[1]!.id;
const overlayId = newId<'TextOverlay'>();
const edit = { projectId: null, templateId: template.id, baseVersion: 3 };
const parses = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('BRK1-CMD contract: commands', () => {
  it('names the six commands', () => {
    expect([N.moveCut, N.splitSlot, N.setRole, N.removeText, N.setTempo, N.dismissDoubt]).toEqual([
      'template.slot.moveCut',
      'template.slot.split',
      'template.slot.setRole',
      'template.text.remove',
      'template.setTempo',
      'template.doubt.dismiss',
    ]);
  });

  it('moves and splits at any rate, snapping to a frame unless asked for a beat', () => {
    expect(CUT_SNAPS).toEqual(['frame', 'beat']);
    const move = P[N.moveCut].parse({ ...edit, slotId, to: at(1500, FrameRate.of(1000)) });
    expect(move.snap).toBe('frame');
    expect(P[N.moveCut].parse({ ...edit, slotId, to: at(40), snap: 'beat' }).snap).toBe('beat');
    expect(parses(P[N.moveCut], { ...edit, slotId, to: at(40), snap: 'second' })).toBe(false);
    expect(parses(P[N.moveCut], { ...edit, slotId })).toBe(false);
    expect(P[N.splitSlot].parse({ ...edit, slotId, at: at(40) }).snap).toBe('frame');
    expect(parses(P[N.splitSlot], { ...edit, baseVersion: 0, slotId, at: at(40) })).toBe(false);
  });

  it('takes a role, overlays to remove, a tempo factor and a doubt to dismiss', () => {
    expect(parses(P[N.setRole], { ...edit, slotId, role: 'peak' })).toBe(true);
    expect(parses(P[N.setRole], { ...edit, slotId, role: 'intro' })).toBe(false);
    expect(parses(P[N.removeText], { ...edit, overlayIds: [overlayId] })).toBe(true);
    expect(parses(P[N.removeText], { ...edit, overlayIds: [] })).toBe(false);
    expect(parses(P[N.removeText], { ...edit, overlayIds: Array(501).fill(overlayId) })).toBe(false);
    for (const factor of [0.5, 2]) expect(parses(P[N.setTempo], { ...edit, factor })).toBe(true);
    for (const factor of [1, 3, 0.25, '2']) expect(parses(P[N.setTempo], { ...edit, factor })).toBe(false);
    for (const target of [{ kind: 'slot', slotId }, { kind: 'text', overlayId }, { kind: 'template' }])
      expect(parses(P[N.dismissDoubt], { ...edit, target, reason: 'cutUnsure' })).toBe(true);
    expect(parses(P[N.dismissDoubt], { ...edit, target: { kind: 'template' }, reason: 'looksOff' })).toBe(
      false,
    );
    expect(parses(P[N.dismissDoubt], { ...edit, target: { kind: 'slot' }, reason: 'cutUnsure' })).toBe(false);
  });

  it('editIntent takes a typed description alone', () => {
    expect(P[N.editIntent].parse({ ...edit, slotId, intent: { text: '  a slow pan  ' } }).intent).toEqual({
      text: 'a slow pan',
    });
    expect(parses(P[N.editIntent], { ...edit, slotId, intent: { text: '   ' } })).toBe(false);
  });

  it('declares its errors', () => {
    expect(
      [
        TemplateFirstSlotCut,
        TemplateCutOutOfRange,
        TemplateOverlayNotFound,
        TemplateDoubtNotFound,
        TemplateProposalsUnreadable,
        TemplateBudgetReached,
      ].map((error) => [error().code, error().retryable]),
    ).toEqual([
      ['templates.first_slot_cut', false],
      ['templates.cut_out_of_range', false],
      ['templates.overlay_not_found', false],
      ['templates.doubt_not_found', false],
      ['templates.proposals_unreadable', true],
      ['templates.budget_reached', false],
    ]);
  });
});

const answer: TemplateProposals = {
  baseVersion: 3,
  proposals: [
    { id: 'p1', command: N.moveCut, payload: { slotId, to: at(42), snap: 'frame' }, why: 'The cut is late.' },
    { id: 'p2', command: N.editIntent, payload: { slotId, intent: { text: 'slow pan' } }, why: 'It moves.' },
  ],
  dropped: 1,
  note: null,
  model: { provider: 'local', model: 'gemma', local: true },
};

describe('BRK1-CMD contract: templates.proposeEdits', () => {
  it('reads the request: a message of 1–2000 characters, slots optional', () => {
    const input = { templateId: template.id, baseVersion: 3, message: ' the cut at 7 s is one shot ' };
    expect(templateProposeEditsInputSchema.parse(input).message).toBe('the cut at 7 s is one shot');
    expect(parses(templateProposeEditsInputSchema, { ...input, slotIds: [slotId], projectId: null })).toBe(
      true,
    );
    expect(parses(templateProposeEditsInputSchema, { ...input, message: '  ' })).toBe(false);
    expect(parses(templateProposeEditsInputSchema, { ...input, message: 'x'.repeat(2001) })).toBe(false);
    expect(parses(templateProposeEditsInputSchema, { ...input, slotIds: [] })).toBe(false);
  });

  it('allows only its commands, with payloads that parse and a short why', () => {
    expect(PROPOSAL_COMMANDS).toHaveLength(10);
    expect(templateProposalsSchema.parse(answer)).toEqual(answer);
    const one = answer.proposals[0]!;
    for (const command of [N.approveSlots, N.remove, N.setHead, 'shell.exec'])
      expect(parses(templateProposalSchema, { ...one, command })).toBe(false);
    expect(parses(templateProposalSchema, { ...one, payload: { slotId } })).toBe(false);
    expect(parses(templateProposalSchema, { ...one, why: 'x'.repeat(301) })).toBe(false);
    expect(parses(templateProposalSchema, { ...one, id: 'P 1' })).toBe(false);
    const many = Array.from({ length: MAX_PROPOSALS + 1 }, (_, i) => ({ ...one, id: `p${i}` }));
    expect(parses(templateProposalsSchema, { ...answer, proposals: many })).toBe(false);
  });

  it('makes an accepted proposal a command on the current head', () => {
    const command = proposalCommand(answer.proposals[1]!, { ...edit, baseVersion: 5 });
    expect(command).toEqual({
      name: N.editIntent,
      payload: {
        slotId,
        intent: { text: 'slow pan' },
        projectId: null,
        templateId: template.id,
        baseVersion: 5,
      },
    });
    expect(P[N.editIntent].safeParse(command.payload).success).toBe(true);
  });

  it('is served, and answers not_implemented while the service has none', async () => {
    const base: TemplatesService = {
      list: async () => ok({ items: [], nextCursor: null }),
      get: async () => ok({ summary: undefined as never, template }),
      versions: async () => ok([]),
      formats: async () => ok([]),
    };
    const serve = (service: TemplatesService) => {
      const { port1, port2 } = channel();
      serveRpc(templatesRouter(service), port1, { context: {} });
      return connectRpc(templatesContract, port2, { peer: 'agent' }).client;
    };
    const input = { templateId: template.id, baseVersion: 3, message: 'merge 2 and 3' };
    expect(await serve({ ...base, proposeEdits: async () => ok(answer) }).proposeEdits(input)).toEqual(
      answer,
    );
    await expect(serve(base).proposeEdits(input)).rejects.toMatchObject({
      data: { code: 'core.not_implemented', params: { feature: 'templates.proposeEdits' } },
    });
  });
});

describe('BRK1-CMD contract: the kept reel', () => {
  it('is on the media host under template-reel/<templateId>', () => {
    const url = templateReelUrl(template.id);
    expect(url).toBe(`app://media/template-reel/${template.id}`);
    expect(TEMPLATE_REEL_KEY_PATTERN.test(new URL(url).pathname.slice(1))).toBe(true);
    for (const key of [
      'template-reel/../x',
      `template-reel/${template.id}/a`,
      'template-reel/',
      'originals/x',
    ])
      expect(TEMPLATE_REEL_KEY_PATTERN.test(key)).toBe(false);
  });
});
