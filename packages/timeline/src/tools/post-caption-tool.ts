// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: `timeline.setPostCaption` as the AI has it. The AI states a post caption's parts (the body, the hashtags,
 * the search phrases); this tool assembles the text in the platform's order, adds the credit line itself when
 * the person keeps the credit on, and refuses anything outside the platform's rule in words the model can act
 * on. The rule is core's `POST_CAPTION_RULES`: every number here is read from it, so another platform is another
 * entry there. The command it dispatches keeps the text and changes nothing else in the video.
 */
import {
  buildPostCaption,
  err,
  ok,
  POST_CAPTION_COMMAND,
  POST_CAPTION_CREDIT_SETTING,
  POST_CAPTION_PLATFORMS,
  POST_CAPTION_RULES,
  postCaptionPartsSchema,
  postCaptionResultSchema,
  postCaptionRule,
  ulidSchema,
  ValidationError,
  type AsyncResult,
  type PostCaptionIssue,
  type PostCaptionRule,
} from '@taalcut/core';
import { z } from 'zod';
import { editCommandTool } from './edit-command-tool';

export interface PostCaptionToolDeps {
  /**
   * Whether the person keeps the credit line on (core's POST_CAPTION_CREDIT_SETTING, the caption panel's
   * switch). The model has no say in it. Absent: the setting's default.
   */
  readonly postCaptionCredit?: () => AsyncResult<boolean>;
}

const rules = Object.values(POST_CAPTION_RULES) as readonly PostCaptionRule[];
/** "Instagram: 1 to 4", for each platform of the table. */
const perPlatform = (count: (rule: PostCaptionRule) => { readonly min: number; readonly max: number }) =>
  rules.map((rule) => `${rule.name}: ${count(rule).min} to ${count(rule).max}`).join('; ');

const input = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  platform: z.enum(POST_CAPTION_PLATFORMS).describe('Where it will be posted'),
  body: postCaptionPartsSchema.shape.body.describe(
    'The words: a hook line, what this video really shows, one ask. No credit line',
  ),
  hashtags: postCaptionPartsSchema.shape.hashtags.describe(
    `This video’s subject, without #. In the whole caption, ${perPlatform((rule) => rule.hashtags)}`,
  ),
  keywords: postCaptionPartsSchema.shape.keywords.describe(
    `Phrases people type into search for this subject. ${perPlatform((rule) => rule.keywords)}`,
  ),
});

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** One thing outside the rule, as a sentence that says what to change. */
function refusal(issue: PostCaptionIssue, rule: PostCaptionRule): string {
  switch (issue.code) {
    case 'bodyEmpty':
      return 'The body is empty: write the caption’s words in body.';
    case 'creditTyped':
      return (
        `Leave the credit line out: Taalcut adds "${rule.credit}" itself when the person wants it, so never ` +
        'type it or its handle in body, hashtags or keywords.'
      );
    case 'hashtagInvalid':
      return `"${issue.tag}" is not a hashtag: one word of letters, digits or _, with no spaces or punctuation.`;
    case 'keywordInvalid':
      return (
        `The search phrase "${issue.keyword}" cannot hold a comma, a bracket, a # or a line break: give ` +
        'each phrase as its own item.'
      );
    case 'hashtagsFew':
      return (
        `${rule.name} needs at least ${issue.min} ${plural(issue.min, 'hashtag', 'hashtags')} and this ` +
        `caption has ${issue.count}: add one that names this video’s subject.`
      );
    case 'hashtagsMany': {
      const typed = issue.inBody
        ? ` (${issue.inBody} typed in the body ${plural(issue.inBody, 'counts', 'count')} too)`
        : '';
      return (
        `${rule.name} takes at most ${issue.max} hashtags in the whole caption and this has ` +
        `${issue.count}${typed}: keep the ${issue.max} that name this video’s subject.`
      );
    }
    case 'keywordsMissing':
      return (
        `The search phrases are missing: give ${rule.keywords.min} to ${rule.keywords.max} in keywords. ` +
        'Taalcut puts them in brackets at the very end.'
      );
    case 'keywordsFew':
      return `Give at least ${issue.min} search phrases in keywords: there ${plural(issue.count, 'is', 'are')} ${issue.count}.`;
    case 'keywordsMany':
      return `Give at most ${issue.max} search phrases in keywords: there are ${issue.count}.`;
    case 'tooLong':
      return (
        `The whole caption is ${issue.length} characters and ${rule.name} takes ${issue.max}: shorten the ` +
        `body by at least ${issue.length - issue.max}.`
      );
    case 'creditMissing':
    case 'creditRepeated':
      return `The credit line must be there once: leave it to Taalcut and never type "${rule.credit}".`;
  }
}

/** What the tool answers a caption outside the rule with: every fault, then what to send again. */
export function postCaptionRefusal(issues: readonly PostCaptionIssue[], rule: PostCaptionRule): string {
  return `Not saved. ${issues.map((issue) => refusal(issue, rule)).join(' ')} Send all three parts again.`;
}

export function postCaptionTool(deps: PostCaptionToolDeps = {}) {
  return editCommandTool({
    command: POST_CAPTION_COMMAND,
    description:
      'Saves the caption to post under this video on a platform (the post’s own text, never subtitles) from ' +
      'its parts: body, hashtags, keywords. Taalcut assembles them in the platform’s order, adds the credit ' +
      'line itself when the person wants one, and refuses what is outside the platform’s rule, saying what ' +
      'to fix. Changes nothing else in the video. Answers the assembled text: show it to the person as written.',
    summary: 'Saves the caption to post under the video, built from its parts.',
    tags: ['caption', 'post', 'social', 'instagram', 'hashtags', 'publish'],
    input,
    output: postCaptionResultSchema,
    payload: async (call) => {
      const credit = deps.postCaptionCredit
        ? await deps.postCaptionCredit()
        : ok(POST_CAPTION_CREDIT_SETTING.defaultValue);
      if (!credit.ok) return credit;
      const { projectId, timelineId, platform, ...parts } = call;
      const built = buildPostCaption(platform, parts, { credit: credit.value });
      if (built.issues.length > 0)
        return err(
          ValidationError(
            { field: 'caption' },
            { detail: postCaptionRefusal(built.issues, postCaptionRule(platform)) },
          ),
        );
      return ok({ projectId, timelineId, platform, text: built.text, writtenBy: 'ai' });
    },
  });
}
