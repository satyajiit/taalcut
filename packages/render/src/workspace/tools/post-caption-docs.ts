// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: `taalcut/edit-post-caption`, the guide the Editor reads before it writes the caption to post under a
 * video. It is an editing guide, so it is read a 1,600-character page at a time: the whole guide is one page.
 * Each platform's counts are written from core's rule table (the one `timeline.setPostCaption` enforces), so
 * the guide cannot say another number. It names no genre and lists no words: what a good caption says is the
 * model's, from what the video shows. Nothing here can look anything up, and the guide says so.
 */
import { POST_CAPTION_PLATFORMS, POST_CAPTION_RULES } from '@taalcut/core';

/** One platform's rule in a line, from the table. */
function ruleLine(platform: (typeof POST_CAPTION_PLATFORMS)[number]): string {
  const rule = POST_CAPTION_RULES[platform];
  return (
    `${rule.name}: ${rule.hashtags.min} to ${rule.hashtags.max} hashtags in the whole caption (one in the ` +
    `body counts), ${rule.keywords.min} to ${rule.keywords.max} search phrases, ${rule.maxLength} characters ` +
    `in all. The feed shows about the first ${rule.feedCut} before "more".`
  );
}

export const EDIT_POST_CAPTION_GUIDE = {
  topic: 'taalcut/edit-post-caption',
  text: `# Editing: post captions

A post caption is the text posted under the video on a platform. It is never subtitles and never a change to the video: no captions tool, clip, text, graphic or export.

1. Read timeline.get: what each clip shows, the words on screen, what is said. Write from that and the person's words only.
2. Save with timeline.setPostCaption: platform, body, hashtags, keywords. Taalcut puts them in the platform's order and adds the credit line when the person wants it: never type the credit or its handle. A refusal names what to fix; send all three parts again.
3. Asked in the chat: show the text the tool answered, exactly. Asked in the caption panel: say in one line that it is saved.

${POST_CAPTION_PLATFORMS.map(ruleLine).join('\n')}

body:
- The first line is the hook, whole before the feed cuts it: one specific thing from this video.
- Then two or three sentences of what the video really shows: the named place, what happens, the detail only this video has. No line that would fit any video.
- End on one clear ask: a question, or to save or share.
- The person's language and spelling. No invented fact, number, name or claim. An emoji or two at most.

hashtags: each names this video's subject. Never filler that would fit any video.

keywords: phrases a person types into search to find a video like this, most specific first.

You cannot look anything up: never say a tag or phrase is trending, or what views it gets.`,
} as const;
