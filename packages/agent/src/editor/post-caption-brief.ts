// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: a post caption asked for in the editor's caption panel ("Generate with AI"). The platform picked there
 * and the user's note travel on the message as data; the run's brief keeps the request, says so in the note every
 * system prompt of the run ends with, and sends the message to the Editor whatever its words are. The handoff
 * check (post-caption-completion.ts) holds the step to a caption saved for that platform.
 */
import { postCaptionRule, type PostCaptionRequest } from '@taalcut/core';
import type { EditorRoute } from './editor-route';

/** The guide the Editor reads before it writes a caption (render's editing guides). */
export const POST_CAPTION_GUIDE = 'taalcut/edit-post-caption';

/**
 * What the note says of a caption asked for in the caption panel. The platform is data from the panel's own
 * control, so the model is told it plainly and the handoff check holds it to it; the note is the user's words.
 */
export function postCaptionNote({ platform, note }: PostCaptionRequest): string {
  const { name } = postCaptionRule(platform);
  const words = note
    ? '`note` below is what they want it to say, in their own words.'
    : 'They left no note: write it from what the video shows.';
  return [
    '# The post caption the user asked for',
    `The user pressed "Generate with AI" in the editor's caption panel: they want the caption to post under this video on ${name} (the post's own text, never subtitles). Read what the video really shows with timeline.get, read workspace.docs topic ${POST_CAPTION_GUIDE}, then save the caption's parts (body, hashtags, keywords) with timeline.setPostCaption and platform "${platform}". The tool assembles the text and adds the credit line itself; when it refuses, fix what it names and send the parts again. Change nothing else in the video: no clip, text, graphic, subtitle or export. Taalcut checks this: the step cannot hand off until a caption for ${platform} was saved in this run. ${words}`,
    `\`\`\`json\n${JSON.stringify({ platform, ...(note ? { note } : {}) })}\n\`\`\``,
  ].join('\n\n');
}

/**
 * A docked run's brief with the caption its message asks for: the request kept, told in the note, and the route
 * the Editor's (a panel's request is never a question or a new video, whatever the note's words are). A brief
 * with no request is returned as it is.
 */
export function withPostCaption<Brief extends { readonly note: string; readonly route: EditorRoute }>(
  brief: Brief,
  request: PostCaptionRequest | undefined,
): Brief & { readonly postCaption?: PostCaptionRequest } {
  if (!request) return brief;
  return {
    ...brief,
    route: 'edit',
    note: `${brief.note}\n\n${postCaptionNote(request)}`,
    postCaption: request,
  };
}
