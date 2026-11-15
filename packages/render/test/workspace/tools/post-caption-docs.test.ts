// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: `taalcut/edit-post-caption`, the guide the Editor reads before it writes a post caption. It is one page,
 * its counts are core's rule table's, it sends the caption through timeline.setPostCaption, and it claims no
 * research: nothing in the app can look up what is trending.
 */
import { POST_CAPTION_PLATFORMS, POST_CAPTION_RULES, unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import { DOCS_TOPICS, workspaceDocsTool } from '../../../src/workspace/tools/docs-tool';

const TOPIC = 'taalcut/edit-post-caption';
const run = (input: Record<string, unknown>) => {
  const tool = workspaceDocsTool();
  return tool.run(tool.input.parse(input), {} as never);
};

it('is listed, and is read whole in one page', async () => {
  const index = unwrap(await run({}));
  expect(index.topics?.map((entry) => entry.topic)).toContain(TOPIC);
  const page = unwrap(await run({ topic: TOPIC }));
  expect(page.pages).toBe(1);
  expect(page.text).toBe(DOCS_TOPICS.find((entry) => entry.topic === TOPIC)?.text);
  expect(page.text!.length).toBeLessThanOrEqual(1600);
  expect(page.note).toContain('Built-in Taalcut editing guide');
});

it('states each platform’s counts from the rule table, and the route through the tool', async () => {
  const text = unwrap(await run({ topic: TOPIC })).text!;
  for (const platform of POST_CAPTION_PLATFORMS) {
    const rule = POST_CAPTION_RULES[platform];
    expect(text).toContain(
      `${rule.name}: ${rule.hashtags.min} to ${rule.hashtags.max} hashtags in the whole caption (one in the ` +
        `body counts), ${rule.keywords.min} to ${rule.keywords.max} search phrases, ${rule.maxLength} ` +
        `characters in all. The feed shows about the first ${rule.feedCut} before "more".`,
    );
    // The credit line is the tool's to add: the guide never spells it for the model to copy.
    expect(text).not.toContain(rule.credit);
  }
  for (const part of [
    'It is never subtitles and never a change to the video',
    'Read timeline.get',
    'Save with timeline.setPostCaption: platform, body, hashtags, keywords',
    'never type the credit or its handle',
    'Asked in the chat: show the text the tool answered, exactly',
    'The first line is the hook',
    'No line that would fit any video',
    'End on one clear ask',
    "The person's language and spelling. No invented fact, number, name or claim",
    "hashtags: each names this video's subject",
    'keywords: phrases a person types into search',
  ])
    expect(text).toContain(part);
});

it('claims no research, and names no genre or word to use', async () => {
  const text = unwrap(await run({ topic: TOPIC })).text!;
  expect(text).toContain('You cannot look anything up: never say a tag or phrase is trending');
  // No tag is suggested: the only "#" is the heading's.
  expect(text.match(/#/gu)).toEqual(['#']);
  // The targets guide sends a post-copy request here, and no longer to a field of the handoff.
  const targets = DOCS_TOPICS.find((entry) => entry.topic === 'taalcut/edit-targets')!.text;
  expect(targets).toContain('Read workspace.docs topic taalcut/edit-post-caption');
  expect(targets).toContain('timeline.setPostCaption');
  expect(targets).not.toContain('handOff.postCaption');
});
