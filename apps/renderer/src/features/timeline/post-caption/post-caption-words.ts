// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: what the caption panel says. A platform's rule in one line, what a person's own text has outside it (said
 * kindly: a flag, never a refusal), the words the panel sends to the chat, and a caption's state in a line for a
 * tile. Every number is core's rule table's (`POST_CAPTION_RULES`). Pure: the caller's i18n.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import {
  postCaptionRule,
  type PostCaptionIssue,
  type PostCaptionPlatform,
  type Timeline,
} from '@taalcut/core';

/**
 * The names Undo and Redo say for the two commands (in ⌘K and the toasts), as make-messages-edit.ts does for the
 * editor's edits. Explicit ids: the backend names the commands.
 */
export const POST_CAPTION_COMMAND_LABELS: readonly MessageDescriptor[] = [
  msg({ id: 'commands.timeline.setPostCaption', message: 'Change the post caption' }),
  msg({ id: 'commands.settings.setPostCaptionCredit', message: 'Change the caption’s credit line' }),
];

/** "1 to 4 hashtags · search phrases in brackets at the end · up to 2,200 characters". */
export function postCaptionRuleLine(i18n: I18n, platform: PostCaptionPlatform): string {
  const rule = postCaptionRule(platform);
  const min = i18n.number(rule.hashtags.min);
  const max = i18n.number(rule.hashtags.max);
  const length = i18n.number(rule.maxLength);
  return i18n._(
    msg`${min} to ${max} hashtags · search phrases in brackets at the end · up to ${length} characters`,
  );
}

/**
 * The words the panel's "Generate with AI" sends. The platform and the note go with them as data
 * (`postCaption`), so nothing reads the platform out of these words; packages/agent holds the English ones to the
 * Editor's route (test/editor/post-caption-request.test.ts).
 */
export function postCaptionRequestWords(i18n: I18n, platform: PostCaptionPlatform): string {
  const { name } = postCaptionRule(platform);
  return i18n._(msg`Write a caption for this video’s ${name} post.`);
}

/**
 * What a person's own text has outside the platform's rule, in a sentence each. The issues only the AI's parts
 * can have (the tool answers those to the model) say nothing here.
 */
export function postCaptionIssueWords(
  i18n: I18n,
  platform: PostCaptionPlatform,
  issue: PostCaptionIssue,
): string | null {
  const { name, credit } = postCaptionRule(platform);
  switch (issue.code) {
    case 'hashtagsFew': {
      const min = i18n.number(issue.min);
      return i18n._(
        plural(issue.count, {
          0: `No hashtags yet. ${name} captions here carry at least ${min}.`,
          one: `Only # hashtag. ${name} captions here carry at least ${min}.`,
          other: `Only # hashtags. ${name} captions here carry at least ${min}.`,
        }),
      );
    }
    case 'hashtagsMany': {
      const max = i18n.number(issue.max);
      return i18n._(
        plural(issue.count, {
          one: `# hashtag, and ${name} takes ${max} at most.`,
          other: `# hashtags, and ${name} takes ${max} at most.`,
        }),
      );
    }
    case 'keywordsMissing':
      return i18n._(msg`No search phrases in brackets at the very end, like (first phrase, second phrase).`);
    case 'keywordsFew': {
      const min = i18n.number(issue.min);
      return i18n._(
        plural(issue.count, {
          one: `# search phrase in the brackets. At least ${min} help people find the post.`,
          other: `# search phrases in the brackets. At least ${min} help people find the post.`,
        }),
      );
    }
    case 'keywordsMany': {
      const max = i18n.number(issue.max);
      return i18n._(
        plural(issue.count, {
          one: `# search phrase in the brackets, and ${max} is the most.`,
          other: `# search phrases in the brackets, and ${max} is the most.`,
        }),
      );
    }
    case 'creditMissing':
      return i18n._(msg`The line “${credit}” is switched on, and it is not in this text.`);
    case 'creditRepeated':
      return i18n._(
        plural(issue.count, {
          one: `The line “${credit}” is in the text # time.`,
          other: `The line “${credit}” is in the text # times.`,
        }),
      );
    case 'tooLong': {
      const max = i18n.number(issue.max);
      return i18n._(
        plural(issue.length - issue.max, {
          one: `# character over ${name}’s ${max}.`,
          other: `# characters over ${name}’s ${max}.`,
        }),
      );
    }
    case 'bodyEmpty':
    case 'creditTyped':
    case 'hashtagInvalid':
    case 'keywordInvalid':
      return null;
  }
}

/** A video's caption in a line, for a tile or a menu: who wrote it, or that there is none yet. */
export function postCaptionTileWords(i18n: I18n, timeline: Pick<Timeline, 'postCaptions'>): string {
  const saved = timeline.postCaptions?.[0];
  if (!saved) return i18n._(msg`Not written yet`);
  const { name } = postCaptionRule(saved.platform);
  return saved.writtenBy === 'ai'
    ? i18n._(msg`${name}, written by Taalcut`)
    : i18n._(msg`${name}, edited by you`);
}

/** What the feed shows of a caption before "more": its first line, cut at the platform's length. */
export function postCaptionFeedLine(
  platform: PostCaptionPlatform,
  text: string,
): { readonly shown: string; readonly cut: boolean } {
  const { feedCut } = postCaptionRule(platform);
  const trimmed = text.trimStart();
  const first = trimmed.split('\n')[0] ?? '';
  const shown = first.length > feedCut ? first.slice(0, feedCut).trimEnd() : first;
  return { shown, cut: shown.length < trimmed.trimEnd().length };
}
