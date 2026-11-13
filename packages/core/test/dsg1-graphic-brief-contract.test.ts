// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ's contract: a brief per overlay and the graphic system, as `Template.graphics.reading`; the review's
 * commands. Made-up reel.
 */
import { describe, expect, it } from 'vitest';
import {
  GRAPHIC_BRIEF_KINDS,
  GRAPHIC_STORY_ROLES,
  graphicBriefOf,
  isNotGraphic,
  newId,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  templateGraphicsSchema,
  templateSchema,
  type GraphicBrief,
  type GraphicReading,
  type Template,
} from '@taalcut/core';
import { issuePaths, json, referenceTemplate } from './helpers/documents';

function brief(overlayId: GraphicBrief['overlayId'], over: Partial<GraphicBrief> = {}): GraphicBrief {
  return {
    overlayId,
    graphic: true,
    reason: null,
    kind: 'incomingMessage',
    what: 'An incoming message from a friend',
    role: 'question',
    answers: null,
    look: {
      words: 'A white rounded bubble with a tail at the bottom left, like an iMessage thread',
      platform: 'imessage',
      shadow: false,
      avatar: false,
    },
    motion: { words: 'Typing dots for about 0.6 s, then the words; it cuts out', typingSeconds: 0.6 },
    timing: { cue: 'beat', words: 'Lands on the second beat' },
    people: { words: 'Above the person, clear of their head' },
    source: 'model',
    confidence: 0.8,
    ...over,
  };
}

function withReading(): { template: Template; reading: GraphicReading } {
  const template: Template = structuredClone(referenceTemplate());
  const first = template.text[0]!.id;
  const second = newId<'TextOverlay'>();
  template.text.push({ ...template.text[0]!, id: second, text: 'Same as always' });
  const reading: GraphicReading = {
    version: 1,
    prompt: 'graphic-brief/1',
    model: { provider: 'local-runtime', model: 'qwen3.5-4b', local: true },
    briefs: [
      brief(first),
      brief(second, { kind: 'outgoingMessage', role: 'answer', answers: first, source: 'person' }),
    ],
    system: {
      tokens: {
        platform: 'imessage',
        fills: ['#ffffff', '#34c759'],
        text: ['#111111'],
        cornerRadius: 0.42,
        font: { class: 'sans', weight: 500 },
      },
      conversation: [
        { overlayId: first, side: 'left', speaker: 'them' },
        { overlayId: second, side: 'right', speaker: 'me' },
      ],
      stack: { direction: 'down', gap: 0.02 },
      words: 'A two-message thread: their question on the left, the reply on the right, stacked downwards.',
    },
  };
  template.graphics = { uses: [], reading };
  return { template, reading };
}

describe('DSG1 graphic brief', () => {
  it('one list names what a graphic is; story roles stay apart', () => {
    expect(GRAPHIC_BRIEF_KINDS).toEqual([
      'incomingMessage',
      'outgoingMessage',
      'typingIndicator',
      'title',
      'caption',
      'locationTag',
      'lowerThird',
      'pill',
      'label',
      'sticker',
      'callout',
      'callToAction',
      'other',
    ]);
    expect(GRAPHIC_STORY_ROLES).toEqual(expect.arrayContaining(['question', 'answer', 'setup', 'payoff']));
  });

  it('a template carries the reading, and round-trips', () => {
    const { template } = withReading();
    expect(templateSchema.parse(json(template))).toEqual(template);
  });

  it('a reading comes before any design: uses default to none', () => {
    const { reading } = withReading();
    expect(templateGraphicsSchema.parse(json({ reading }))).toEqual({ uses: [], reading });
  });

  it('a template from before DSG1 has no graphics and still parses', () => {
    const template = referenceTemplate();
    expect(template.graphics).toBeUndefined();
    expect(templateSchema.safeParse(json(template)).success).toBe(true);
  });

  it('a reading that is footage keeps its reason, and is left out', () => {
    const { reading } = withReading();
    const sign = brief(reading.briefs[0]!.overlayId, {
      graphic: false,
      reason:
        'A station sign on the platform wall: it moves with the camera and a person passes in front of it',
      kind: 'other',
    });
    const graphics = templateGraphicsSchema.parse(json({ reading: { ...reading, briefs: [sign] } }));
    expect(isNotGraphic(graphics, sign.overlayId)).toBe(true);
    expect(isNotGraphic(graphics, newId<'TextOverlay'>())).toBe(false);
    expect(graphicBriefOf(graphics, sign.overlayId)?.reason).toMatch(/station sign/);
    expect(isNotGraphic(undefined, sign.overlayId)).toBe(false);
    expect(isNotGraphic({}, sign.overlayId)).toBe(false);
  });

  it('refuses what no brief says, and an overlay briefed twice', () => {
    const { template } = withReading();
    const bad = json(template) as {
      graphics: { reading: { prompt: string; briefs: { kind: string; confidence: number }[] } };
    };
    bad.graphics.reading.briefs[0]!.kind = 'billboard';
    bad.graphics.reading.briefs[1]!.confidence = 2;
    bad.graphics.reading.prompt = 'any prompt';
    const paths = issuePaths(templateSchema, bad);
    expect(paths).toContain('graphics.reading.briefs.0.kind');
    expect(paths).toContain('graphics.reading.briefs.1.confidence');
    expect(paths).toContain('graphics.reading.prompt');
    const long = withReading().template;
    long.graphics!.reading!.briefs[0]!.what = 'x'.repeat(201);
    expect(templateSchema.safeParse(json(long)).success).toBe(false);
    const twice = withReading().template;
    twice.graphics!.reading!.briefs[1]!.overlayId = twice.graphics!.reading!.briefs[0]!.overlayId;
    expect(issuePaths(templateSchema, json(twice))).toContain('graphics.reading.briefs.1.overlayId');
  });

  it('template.graphic.set and template.graphic.edit name an overlay at a version', () => {
    expect(TEMPLATE_COMMANDS.setGraphic).toBe('template.graphic.set');
    expect(TEMPLATE_COMMANDS.editGraphic).toBe('template.graphic.edit');
    const base = {
      projectId: null,
      templateId: newId<'Template'>(),
      baseVersion: 3,
      overlayId: newId<'TextOverlay'>(),
    };
    const set = templateCommandPayloads[TEMPLATE_COMMANDS.setGraphic];
    expect(set.parse({ ...base, graphic: false }).graphic).toBe(false);
    expect(set.safeParse({ ...base, graphic: 'no' }).success).toBe(false);
    const edit = templateCommandPayloads[TEMPLATE_COMMANDS.editGraphic];
    expect(edit.parse({ ...base, brief: { role: 'answer', what: 'The creator’s reply' } }).brief).toEqual({
      role: 'answer',
      what: 'The creator’s reply',
    });
    expect(edit.safeParse({ ...base, brief: {} }).success).toBe(false);
    expect(edit.safeParse({ ...base, brief: { kind: 'billboard' } }).success).toBe(false);
  });
});
