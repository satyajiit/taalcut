// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: a made-up reel's template graphics designed by the Designer (a stand-in here): one composition per
 * role, every use naming it with its overlay's words, the files kept in the templates' pool, the vision judge's
 * differences sent back with both frames until it matches, a role the Designer can't do left out with its reason,
 * and never a component, a kit kind or fields.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  graphicComponentsSchema,
  newId,
  NotImplementedError,
  ok,
  type GraphicComposition,
} from '@taalcut/core';
import {
  designTemplateCompositions,
  type DrawOver,
  type TemplateCompositionDeps,
} from '../../../src/workspace/template/design-template';
import type { DesignJob, DesignOverlay, ReelFrame } from '../../../src/workspace/template/designer';
import {
  parseVerdict,
  visionJudge,
  type JudgeModel,
  type JudgeReel,
} from '../../../src/workspace/template/judge';
import { reelMomentsOf } from '../../../src/workspace/template/reel-frames';
import { madeUpReel, QUESTION_WORDS, REPLY_WORDS } from './reel-fixture';
import { standInDesigner } from './stand-in';

const picture = (label: string) => ({
  data: Buffer.from(label).toString('base64'),
  mimeType: 'image/jpeg' as const,
});

function deps(over: Partial<TemplateCompositionDeps> = {}) {
  const kept: GraphicComposition[] = [];
  const design = standInDesigner();
  const all: TemplateCompositionDeps = {
    projectId: newId<'Project'>(),
    design,
    reelFrames: async (brief) =>
      reelMomentsOf(brief).map((moment): ReelFrame => ({
        ...moment,
        picture: picture(`reel ${moment.overlayId} ${moment.seconds}`),
      })),
    keep: async (composition) => {
      kept.push(composition);
      return ok(undefined);
    },
    ...over,
  };
  return { all, kept, design };
}

describe('the template’s graphics, by the Designer (HFW1 tpl)', () => {
  it('designs one composition per role and names it from every use, with the overlay’s words', async () => {
    const { template, question, reply } = madeUpReel();
    const { all, kept, design } = deps();
    const { graphics, outcomes } = await designTemplateCompositions(template, all);
    expect(graphicComponentsSchema.safeParse(graphics).success).toBe(true);
    expect(graphics.compositions).toHaveLength(2);
    expect(kept.map((composition) => composition.hash)).toEqual(graphics.compositions!.map((c) => c.hash));
    expect(graphics.uses).toEqual([
      {
        overlayId: question.id,
        compositionId: graphics.compositions![0]!.id,
        params: { text: QUESTION_WORDS },
      },
      { overlayId: reply.id, compositionId: graphics.compositions![1]!.id, params: { text: REPLY_WORDS } },
    ]);
    // Unjudged without a way to draw and judge it: kept after one round.
    expect(outcomes.map((outcome) => [outcome.role, outcome.matched, outcome.rounds])).toEqual([
      ['incomingMessage', null, 1],
      ['outgoingMessage', null, 1],
    ]);
    // The Designer got the brief in words and the reel's frames round each overlay's life.
    expect(design.jobs[0]!.markdown).toContain("# Design: the reel's incomingMessage");
    expect(design.jobs[0]!.reel.map((frame) => frame.moment)).toEqual([
      'before',
      'entrance',
      'entrance',
      'entrance',
      'hold',
      'exit',
      'exit',
      'exit',
    ]);
  });

  it('draws the design over the reel’s own shot and sends the judge’s differences back until it matches', async () => {
    const { template } = madeUpReel();
    const drawn: { seconds: readonly number[]; over: string }[] = [];
    const drawOver: DrawOver = async ({ seconds, over }) => {
      drawn.push({ seconds, over: Buffer.from(over.data, 'base64').toString() });
      return ok(seconds.map((at) => picture(`design ${at}`)));
    };
    let calls = 0;
    const judge: JudgeReel = async () => {
      calls++;
      return ok({
        matches: calls % 2 === 0,
        differences: calls % 2 === 0 ? [] : ['sits about 40 px too low'],
        by: 'stand-in/judge',
      });
    };
    const { all, design } = deps({ drawOver, judge });
    const { outcomes } = await designTemplateCompositions(template, all);
    expect(outcomes.map((outcome) => [outcome.matched, outcome.rounds])).toEqual([
      [true, 2],
      [true, 2],
    ]);
    // Drawn over the frame just before the question came on, at 2 frames into its entrance and at its middle.
    expect(drawn[0]!.over).toBe('reel ' + template.text[1]!.id + ' 0.967');
    expect(drawn[0]!.seconds).toEqual([0.067, 1.5]);
    const again = design.jobs[1]!.feedback!;
    expect(again.reason).toContain('sits about 40 px too low');
    expect(again.frames.map((frame) => frame.label)).toEqual([
      'the reel, entering, two frames in',
      "your design over the reel's shot, entering, two frames in",
      'the reel, held',
      "your design over the reel's shot, held",
    ]);
  });

  it('leaves a role out with the reason when the Designer has no design or its files can’t be kept', async () => {
    const { template } = madeUpReel();
    const failing = deps({
      design: async () => err(NotImplementedError({ feature: 'designer' })),
    });
    const none = await designTemplateCompositions(template, failing.all);
    expect(none.graphics).toEqual({ uses: [], compositions: [] });
    expect(none.outcomes[0]!.reason).toBe('The Designer failed (core.not_implemented)');
    const unkept = deps({ keep: async () => err(NotImplementedError({ feature: 'templateBlobs' })) });
    const left = await designTemplateCompositions(template, unkept.all);
    expect(left.graphics.compositions).toEqual([]);
    expect(left.outcomes[1]!.reason).toMatch(/could not be kept with the template/);
  });

  it('gives the reply’s brief the incoming bubble’s type as drawn, so the thread shares one size and padding', async () => {
    const { template } = madeUpReel();
    const type = { fontPx: 54, padding: { top: 25, right: 47, bottom: 25, left: 47 } };
    const stand = standInDesigner();
    const design: DesignOverlay = async (job, signal) => {
      const answer = await stand(job, signal);
      if (!answer.ok || !('designed' in answer.value)) return answer;
      return ok({
        designed: { ...answer.value.designed, ...(job.brief.role === 'incomingMessage' ? { type } : {}) },
      });
    };
    const jobs: DesignJob[] = [];
    await designTemplateCompositions(
      template,
      deps({ design: (job, signal) => (jobs.push(job), design(job, signal)) }).all,
    );
    expect(jobs.map((job) => job.brief.role)).toEqual(['incomingMessage', 'outgoingMessage']);
    expect(jobs[0]!.brief.thread).toBeUndefined();
    expect(jobs[1]!.brief.thread).toEqual({ role: 'incomingMessage', type });
    expect(jobs[1]!.markdown).toContain(
      "This conversation's incoming bubble is designed already: its words 54 px font-size, padding 25px 47px 25px 47px.",
    );
  });

  it('reads the judge’s JSON from a model and bounds it', async () => {
    expect(
      parseVerdict('Sure. {"matches": false, "differences": ["two lines where the reel has one"]}'),
    ).toEqual({
      matches: false,
      differences: ['two lines where the reel has one'],
    });
    expect(parseVerdict('no json')).toBeNull();
    expect(parseVerdict('{"matches": "yes"}')).toBeNull();
    const model: JudgeModel = {
      complete: async (request) => {
        const images = request.messages[0]!.content.filter((part) => part.type === 'image');
        return ok({ text: `{"matches": ${images.length === 2}}`, provider: 'stand-in', model: 'judge' });
      },
    };
    const { template, question } = madeUpReel();
    const { overlayBrief } = await import('../../../src/workspace/template/brief');
    const verdict = await visionJudge(model)({
      brief: overlayBrief(template, question)!,
      pairs: [{ moment: 'held', reel: picture('reel'), design: picture('design') }],
    });
    expect(verdict.ok && verdict.value).toEqual({ matches: true, differences: [], by: 'stand-in/judge' });
  });
});
