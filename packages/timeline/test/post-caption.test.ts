// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: `timeline.setPostCaption`. The AI states a post caption's parts; the tool builds the text in the
 * platform's order and refuses what is outside its rule, in words the model can act on. The command keeps the
 * text on the video's timeline document and changes nothing else in it; a person's own text is never refused.
 */
import { err, ok, ValidationError, type AnyTool } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { timelineEditorCapabilities } from '../src/editor-capabilities';
import { EDITOR_ONLY_TOOL_NAMES, REQUEST_TOOL_NAMES } from '../src/skills/editor-skill';
import { MAKER_TOOL_NAMES } from '../src/skills/maker-skill';
import { postCaptionTool } from '../src/tools/post-caption-tool';
import { agentOrigin, commandWorld, ui } from './fixtures/command-world';
import { agentToolContext } from './fixtures/tool-context';
import { fixture } from './simple-editor/fixtures';

const BODY =
  'Sunrise at Hoan Kiem Lake, before the city wakes.\n\nWe walked the whole loop with a cup of egg coffee. Would you get up at five for this?';
const PARTS = {
  platform: 'instagram',
  body: BODY,
  hashtags: ['hanoi', 'HoanKiemLake', 'vietnamtravel', 'eggcoffee'],
  keywords: ['hanoi morning walk', 'hoan kiem lake sunrise', 'egg coffee hanoi'],
};
const GOOD = [
  BODY,
  'Created with @taalcut.app',
  '#hanoi #HoanKiemLake #vietnamtravel #eggcoffee',
  '(hanoi morning walk, hoan kiem lake sunrise, egg coffee hanoi)',
].join('\n\n');
const WITHOUT_CREDIT = GOOD.replace('Created with @taalcut.app\n\n', '');

async function scene(credit?: boolean) {
  const data = fixture();
  const world = commandWorld();
  await world.seed(structuredClone(data.timeline));
  const target = { projectId: data.timeline.projectId, timelineId: data.timeline.id };
  const tool: AnyTool = postCaptionTool(
    credit === undefined ? {} : { postCaptionCredit: async () => ok(credit) },
  );
  const run = (over: Record<string, unknown> = {}) =>
    tool.run(tool.input.parse({ ...target, ...PARTS, ...over }), agentToolContext(world.bus, tool));
  /** The words a refused call is answered with; fails the test when the call was not refused. */
  const refused = async (over: Record<string, unknown>) => {
    const before = structuredClone(world.doc(data.timeline.id));
    const result = await run(over);
    expect(world.doc(data.timeline.id)).toEqual(before);
    if (result.ok) throw new Error('The call was not refused');
    expect(result.error.code).toBe('core.validation');
    return result.error.detail;
  };
  const captions = () => world.doc(data.timeline.id).postCaptions;
  return { data, world, target, tool, run, refused, captions };
}

describe('timeline.setPostCaption, the tool (CAP1)', () => {
  it('builds the exact text from good parts, saves it as the AI’s and answers it', async () => {
    const s = await scene();
    const before = structuredClone(s.world.doc(s.data.timeline.id));
    const result = await s.run();
    expect(result).toEqual({
      ok: true,
      value: {
        timelineId: s.target.timelineId,
        revision: before.revision + 1,
        platform: 'instagram',
        text: GOOD,
      },
    });
    expect(s.captions()).toEqual([{ platform: 'instagram', text: GOOD, writtenBy: 'ai' }]);
    // Nothing else in the video moved: no clip, text, graphic, subtitle or cover.
    const { postCaptions: _made, revision: _now, updatedAt: _at, ...rest } = s.world.doc(s.data.timeline.id);
    const { revision: _was, updatedAt: _then, ...was } = before;
    expect(rest).toEqual(was);
  });

  it('refuses five hashtags, and none', async () => {
    const s = await scene();
    expect(await s.refused({ hashtags: ['one', 'two', 'three', 'four', 'five'] })).toBe(
      'Not saved. Instagram takes at most 4 hashtags in the whole caption and this has 5: keep the 4 that ' +
        'name this video’s subject. Send all three parts again.',
    );
    expect(await s.refused({ hashtags: [] })).toBe(
      'Not saved. Instagram needs at least 1 hashtag and this caption has 0: add one that names this ' +
        'video’s subject. Send all three parts again.',
    );
  });

  it('refuses a hashtag inside the body that takes the total over four', async () => {
    const s = await scene();
    expect(await s.refused({ body: `${BODY} #sunrise` })).toBe(
      'Not saved. Instagram takes at most 4 hashtags in the whole caption and this has 5 (1 typed in the ' +
        'body counts too): keep the 4 that name this video’s subject. Send all three parts again.',
    );
    // Three stated and one in the body is four: saved.
    expect((await s.run({ body: `${BODY} #sunrise`, hashtags: ['hanoi', 'eggcoffee', 'vietnam'] })).ok).toBe(
      true,
    );
  });

  it('refuses a caption with no search phrases, or too few', async () => {
    const s = await scene();
    expect(await s.refused({ keywords: [] })).toBe(
      'Not saved. The search phrases are missing: give 3 to 10 in keywords. Taalcut puts them in brackets ' +
        'at the very end. Send all three parts again.',
    );
    expect(await s.refused({ keywords: ['hanoi walk'] })).toBe(
      'Not saved. Give at least 3 search phrases in keywords: there is 1. Send all three parts again.',
    );
  });

  it('refuses the credit line typed by the model as well', async () => {
    const s = await scene();
    expect(await s.refused({ body: `${BODY}\n\nCreated with @taalcut.app` })).toBe(
      'Not saved. Leave the credit line out: Taalcut adds "Created with @taalcut.app" itself when the ' +
        'person wants it, so never type it or its handle in body, hashtags or keywords. Send all three ' +
        'parts again.',
    );
  });

  it('leaves the credit out when the person turned it off, and still refuses a typed one', async () => {
    const s = await scene(false);
    expect(await s.run()).toMatchObject({ ok: true, value: { text: WITHOUT_CREDIT } });
    expect(s.captions()?.[0]?.text).not.toContain('@taalcut.app');
    expect(await s.refused({ body: `${BODY} Created with @taalcut.app` })).toContain(
      'Leave the credit line out',
    );
    // On when the setting says so, and by default.
    expect(await (await scene(true)).run()).toMatchObject({ ok: true, value: { text: GOOD } });
  });

  it('refuses a caption over the platform’s length, saying by how much', async () => {
    const s = await scene();
    const body = 'x'.repeat(2200);
    const length = body.length + (GOOD.length - BODY.length);
    expect(await s.refused({ body })).toBe(
      `Not saved. The whole caption is ${length} characters and Instagram takes 2200: shorten the body by ` +
        `at least ${length - 2200}. Send all three parts again.`,
    );
  });

  it('names every fault at once, and the hashtag or phrase that is wrong', async () => {
    const s = await scene();
    const words = await s.refused({
      hashtags: ['hanoi travel'],
      keywords: ['hanoi, vietnam', 'egg coffee', 'old quarter'],
    });
    expect(words).toContain('"hanoi travel" is not a hashtag: one word of letters, digits or _');
    expect(words).toContain('The search phrase "hanoi, vietnam" cannot hold a comma');
    expect(await s.refused({ body: '   ' })).toContain('The body is empty');
  });

  it('answers a setting that cannot be read with its error, saving nothing', async () => {
    const s = await scene();
    const failing: AnyTool = postCaptionTool({
      postCaptionCredit: async () => err(ValidationError({ field: 'postCaption.credit' })),
    });
    const result = await failing.run(
      failing.input.parse({ ...s.target, ...PARTS }),
      agentToolContext(s.world.bus, failing),
    );
    expect(result.ok).toBe(false);
    expect(s.captions()).toBeUndefined();
  });

  it('declares itself: a local write of one command, in the Editor’s tools', () => {
    const tool = postCaptionTool();
    expect(tool).toMatchObject({
      name: 'timeline.setPostCaption',
      command: 'timeline.setPostCaption',
      version: '1.0.0',
      costClass: 'local',
      sideEffect: 'write',
    });
    // The model states no credit and no revision: the schema has neither.
    expect(Object.keys((tool.input as unknown as { shape: object }).shape).sort()).toEqual(
      ['body', 'hashtags', 'keywords', 'platform', 'projectId', 'timelineId'].sort(),
    );
    // The Editor's alone: a caption is asked for in the editor, and the Maker's offer does not pay for its schema.
    expect(EDITOR_ONLY_TOOL_NAMES).toContain('timeline.setPostCaption');
    expect([...REQUEST_TOOL_NAMES, ...MAKER_TOOL_NAMES]).not.toContain('timeline.setPostCaption');
    expect(timelineEditorCapabilities.find((entry) => entry.id === 'timeline.setPostCaption')).toEqual({
      id: 'timeline.setPostCaption',
      commands: ['timeline.setPostCaption'],
      tools: ['timeline.setPostCaption'],
      access: 'ai',
    });
  });
});

describe('timeline.setPostCaption, the command (CAP1)', () => {
  it('keeps a person’s own text as written, however it breaks the rule, and marks it theirs', async () => {
    const s = await scene();
    await s.run();
    const own = 'my caption #a #b #c #d #e #f, no list at the end';
    const saved = await s.world.dispatch('timeline.setPostCaption', {
      ...s.target,
      platform: 'instagram',
      text: own,
    });
    expect(saved).toMatchObject({ ok: true, value: { platform: 'instagram', text: own } });
    expect(s.captions()).toEqual([{ platform: 'instagram', text: own, writtenBy: 'person' }]);
  });

  it('is one undo step that puts back the caption as it was, and whose it was', async () => {
    const s = await scene();
    const { projectId } = s.target;
    const set = (text: string | null) =>
      s.world.dispatch('timeline.setPostCaption', { ...s.target, platform: 'instagram', text });
    await s.run();
    await set('Mine now');
    expect((await s.world.bus.undo(projectId, ui)).ok).toBe(true);
    expect(s.captions()).toEqual([{ platform: 'instagram', text: GOOD, writtenBy: 'ai' }]);
    expect((await s.world.bus.undo(projectId, ui)).ok).toBe(true);
    expect(s.captions()).toBeUndefined();
    expect((await s.world.bus.redo(projectId, ui)).ok).toBe(true);
    expect(s.captions()).toEqual([{ platform: 'instagram', text: GOOD, writtenBy: 'ai' }]);

    // Removing it leaves a timeline with no caption field at all; removing nothing writes nothing.
    await set(null);
    expect(s.captions()).toBeUndefined();
    const revision = s.world.doc(s.target.timelineId).revision;
    expect(await set(null)).toMatchObject({ ok: true, value: { revision, text: null } });
    expect(s.world.doc(s.target.timelineId).revision).toBe(revision);
  });

  it('writes nothing for the same text again, and refuses a stale revision when one is given', async () => {
    const s = await scene();
    await s.run();
    const revision = s.world.doc(s.target.timelineId).revision;
    expect(await s.run()).toMatchObject({ ok: true, value: { revision } });
    expect(s.world.doc(s.target.timelineId).revision).toBe(revision);
    const stale = await s.world.dispatch(
      'timeline.setPostCaption',
      { ...s.target, platform: 'instagram', text: 'Later', revision: revision - 1 },
      agentOrigin,
    );
    expect(stale).toMatchObject({ ok: false, error: { code: 'core.conflict' } });
  });
});
