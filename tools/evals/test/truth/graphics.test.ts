// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: a template's graphic reading scored against a made-up reel's truth: a two-message thread and a station
 * sign. Found, lost, kinds, roles, senders, the conversation's order, and the sign never a graphic.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type GraphicBrief, type Template } from '@taalcut/core';
import { truthSchema } from '../../src/truth/schema';
import { scoreTemplate } from '../../src/truth/score';

const rate = FrameRate.of(30);
const at = (frame: number) => RationalTime.of(frame, rate);
const box = { x: 0.1, y: 0.3, width: 0.5, height: 0.04 };

const truth = truthSchema.parse({
  reelId: 'made-up-thread',
  frameRate: { numerator: 30, denominator: 1 },
  source: { durationFrames: 300, width: 1080, height: 1920, orientation: 'portrait' },
  cuts: [150],
  shots: [
    { startFrame: 0, endFrame: 150, subjectWords: ['street'], cameraMotions: ['pan'], static: false },
    { startFrame: 150, endFrame: 300, subjectWords: ['station'], cameraMotions: ['static'], static: true },
  ],
  overlays: [
    {
      text: 'are you coming?',
      startFrame: 30,
      endFrame: 290,
      box,
      kinds: ['incomingMessage'],
      role: 'question',
      speaker: 'them',
    },
    {
      text: 'on my way',
      startFrame: 90,
      endFrame: 290,
      box,
      kinds: ['outgoingMessage'],
      role: 'answer',
      speaker: 'me',
    },
  ],
  sceneText: [{ text: 'CENTRAL STATION' }],
  tempo: { bpm: 120, beatsPerBar: 4, downbeatsMs: [] },
  speech: { present: false },
});

const ids = ['01JDSG1EVA0000000000000001', '01JDSG1EVA0000000000000002', '01JDSG1EVA0000000000000003'];

function brief(overlayId: string, over: Partial<GraphicBrief>): GraphicBrief {
  return {
    overlayId: overlayId as GraphicBrief['overlayId'],
    graphic: true,
    reason: null,
    kind: 'incomingMessage',
    what: 'a message',
    role: 'question',
    answers: null,
    look: { words: '', platform: 'whatsapp', shadow: false, avatar: false },
    motion: { words: '', typingSeconds: null },
    timing: { cue: 'free', words: '' },
    people: { words: '' },
    source: 'model',
    confidence: 0.85,
    ...over,
  };
}

function template(
  briefs: GraphicBrief[],
  conversation: { overlayId: string; speaker: 'me' | 'them' }[],
): Template {
  const text = [
    { id: ids[0], text: 'are you coming?', start: at(30), duration: at(260) },
    { id: ids[1], text: 'on my way', start: at(90), duration: at(200) },
    { id: ids[2], text: 'CENTRAL STATION', start: at(150), duration: at(150) },
  ];
  return {
    canvas: { width: 1080, height: 1920, rate },
    slots: [
      { start: at(0), duration: at(300), intent: { text: 'a street', subject: 'street', motion: 'pan' } },
    ],
    text,
    beatMap: null,
    audio: { speech: null },
    graphics: {
      uses: [],
      reading: {
        version: 1,
        prompt: 'graphic-brief/1',
        model: { provider: 'local-runtime', model: 'qwen3.5-4b', local: true },
        briefs,
        system: {
          tokens: { platform: 'whatsapp', fills: [], text: [], cornerRadius: null, font: null },
          conversation: conversation.map((item) => ({
            ...item,
            side: item.speaker === 'me' ? 'right' : 'left',
          })),
          stack: null,
          words: '',
        },
      },
    },
  } as unknown as Template;
}

describe('scoring a graphic reading (DSG1-READ)', () => {
  it('scores a right reading: both messages found in order, the sign removed and never a graphic', () => {
    const score = scoreTemplate(
      template(
        [
          brief(ids[0]!, {}),
          brief(ids[1]!, {
            kind: 'outgoingMessage',
            role: 'answer',
            answers: ids[0] as GraphicBrief['answers'],
          }),
          brief(ids[2]!, { graphic: false, reason: 'A sign on the wall', kind: 'other', role: 'other' }),
        ],
        [
          { overlayId: ids[0]!, speaker: 'them' },
          { overlayId: ids[1]!, speaker: 'me' },
        ],
      ),
      truth,
    );
    expect(score.overlays).toMatchObject({
      kept: 2,
      keptRemoved: 0,
      sceneKept: 1,
      sceneRemoved: 1,
      sceneUnmarked: 0,
    });
    expect(score.graphics).toEqual({
      model: { provider: 'local-runtime', model: 'qwen3.5-4b', local: true },
      briefs: 3,
      found: 2,
      lost: [],
      kinds: { right: 2, scored: 2, wrong: [] },
      roles: { right: 2, scored: 2, wrong: [] },
      speakers: { right: 2, scored: 2, wrong: [] },
      conversationOrder: true,
      sceneAsGraphic: 0,
      sceneRemoved: 1,
    });
  });

  it('counts a lost graphic, a wrong kind and sender, and the sign read as a graphic', () => {
    const score = scoreTemplate(
      template(
        [
          brief(ids[0]!, { graphic: false, reason: 'scene' }),
          brief(ids[1]!, { kind: 'caption', role: 'setup' }),
          brief(ids[2]!, { kind: 'title', role: 'hook' }),
        ],
        [],
      ),
      truth,
    );
    expect(score.overlays).toMatchObject({ keptRemoved: 1, sceneUnmarked: 1 });
    expect(score.graphics).toMatchObject({
      found: 1,
      lost: [0],
      kinds: { right: 0, scored: 1, wrong: [1] },
      roles: { right: 0, scored: 1, wrong: [1] },
      speakers: { right: 0, scored: 1, wrong: [1] },
      conversationOrder: null,
      sceneAsGraphic: 1,
    });
  });

  it('is null without a reading', () => {
    const plain = template([], []);
    const score = scoreTemplate({ ...plain, graphics: undefined } as unknown as Template, truth);
    expect(score.graphics).toBeNull();
  });
});
