// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';

/** Built-in API tool descriptions; remote MCP descriptions remain provider content. */
export const PLUGIN_TOOL_MESSAGES = [
  msg({
    id: 'List connected social accounts, optionally for a customer group.',
    message: 'List connected social accounts, optionally for a customer group.',
  }),
  msg({ id: 'List customer groups.', message: 'List customer groups.' }),
  msg({
    id: 'Create an OAuth connection link for a platform. The person completes sign-in in their browser.',
    message: 'Create an OAuth connection link for a platform. The person completes sign-in in their browser.',
  }),
  msg({
    id: 'Read platform rules, settings schema and available provider helper tools for a channel.',
    message: 'Read platform rules, settings schema and available provider helper tools for a channel.',
  }),
  msg({
    id: 'Invoke a provider helper discovered in channel settings.',
    message: 'Invoke a provider helper discovered in channel settings.',
  }),
  msg({
    id: 'Delete a channel and its scheduled posts. Confirm affected content first.',
    message: 'Delete a channel and its scheduled posts. Confirm affected content first.',
  }),
  msg({ id: 'Verify the connected credential.', message: 'Verify the connected credential.' }),
  msg({
    id: 'Read the workspace and, for OAuth tokens, the approving user.',
    message: 'Read the workspace and, for OAuth tokens, the approving user.',
  }),
  msg({
    id: 'Find the next available posting slot for a channel.',
    message: 'Find the next available posting slot for a channel.',
  }),
  msg({
    id: 'Read channel metrics. date is the number of days to look back, not a calendar date.',
    message: 'Read channel metrics. date is the number of days to look back, not a calendar date.',
  }),
  msg({
    id: 'Read published-post metrics. date is the number of days to look back.',
    message: 'Read published-post metrics. date is the number of days to look back.',
  }),
  msg({
    id: 'Read publishing notifications, 100 per page. Pages start at zero.',
    message: 'Read publishing notifications, 100 per page. Pages start at zero.',
  }),
  msg({
    id: 'List posts and current provider settings within an ISO date range.',
    message: 'List posts and current provider settings within an ISO date range.',
  }),
  msg({
    id: 'Create a draft, scheduled or immediate post. Upload media first and inspect each channel’s settings. This can publish to social accounts.',
    message:
      'Create a draft, scheduled or immediate post. Upload media first and inspect each channel’s settings. This can publish to social accounts.',
  }),
  msg({
    id: 'Delete a post and every post in the same group.',
    message: 'Delete a post and every post in the same group.',
  }),
  msg({ id: 'Delete all posts in a group.', message: 'Delete all posts in a group.' }),
  msg({
    id: 'Find provider content for a published post whose release ID is missing.',
    message: 'Find provider content for a published post whose release ID is missing.',
  }),
  msg({
    id: 'Link a post to its published provider content to restore analytics.',
    message: 'Link a post to its published provider content to restore analytics.',
  }),
  msg({
    id: 'Move a post to draft or schedule. Scheduling starts publishing at the stored date.',
    message: 'Move a post to draft or schedule. Scheduling starts publishing at the stored date.',
  }),
  msg({
    id: 'Merge provider settings into an unpublished draft or scheduled post. Omit __type.',
    message: 'Merge provider settings into an unpublished draft or scheduled post. Omit __type.',
  }),
  msg({
    id: 'Upload a library asset or completed render using multipart form data. Supply exactly one assetId or renderId. Returns a Postiz media id and path.',
    message:
      'Upload a library asset or completed render using multipart form data. Supply exactly one assetId or renderId. Returns a Postiz media id and path.',
  }),
  msg({
    id: 'Ask Postiz to import publicly accessible media. Use the returned id and path for posts.',
    message: 'Ask Postiz to import publicly accessible media. Use the returned id and path for posts.',
  }),
  msg({
    id: 'Check media processing. Ready may include a warning that the original file was kept.',
    message: 'Check media processing. Ready may include a warning that the original file was kept.',
  }),
  msg({
    id: 'Search uploaded media and reuse its Postiz path; 18 results per page.',
    message: 'Search uploaded media and reuse its Postiz path; 18 results per page.',
  }),
  msg({
    id: 'Generate a video through Postiz. May consume credits.',
    message: 'Generate a video through Postiz. May consume credits.',
  }),
  msg({
    id: 'Invoke a video-generator helper, such as listing voices.',
    message: 'Invoke a video-generator helper, such as listing voices.',
  }),
  msg({
    id: 'Create captioned vertical clips from a YouTube video, optionally with drafts on selected channels. Poll getClipping.',
    message:
      'Create captioned vertical clips from a YouTube video, optionally with drafts on selected channels. Poll getClipping.',
  }),
  msg({
    id: 'Read clipping progress and inspect each clip for failures, even when the job is completed.',
    message: 'Read clipping progress and inspect each clip for failures, even when the job is completed.',
  }),
  msg({ id: 'List previous clippings, 20 per page.', message: 'List previous clippings, 20 per page.' }),
  msg({
    id: 'Read the current Instagram Edits screen (home, editor or loading) and active state.',
    message: 'Read the current Instagram Edits screen (home, editor or loading) and active state.',
  }),
  msg({
    id: 'List Instagram Edits music feed categories (For You, Trending, Original audio, Royalty-free) and track counts.',
    message:
      'List Instagram Edits music feed categories (For You, Trending, Original audio, Royalty-free) and track counts.',
  }),
  msg({
    id: 'List or search Instagram music tracks by tab (Trending, For You, Original audio, Royalty-free) and license, including audioAssetId and viral hook timestamps.',
    message:
      'List or search Instagram music tracks by tab (Trending, For You, Original audio, Royalty-free) and license, including audioAssetId and viral hook timestamps.',
  }),
  msg({
    id: 'List the signed-in Instagram account’s saved audio tracks from Edits.',
    message: 'List the signed-in Instagram account’s saved audio tracks from Edits.',
  }),
  msg({
    id: 'Read full metadata and highlight segments for an Instagram music track by ID or exact title.',
    message: 'Read full metadata and highlight segments for an Instagram music track by ID or exact title.',
  }),
  msg({
    id: 'Bookmark an Instagram music track into the account’s Saved audio tab.',
    message: 'Bookmark an Instagram music track into the account’s Saved audio tab.',
  }),
  msg({
    id: 'Search the Instagram Edits sound-effects catalog by query or category.',
    message: 'Search the Instagram Edits sound-effects catalog by query or category.',
  }),
  msg({
    id: 'List local and mobile cloud-synced projects in Instagram Edits.',
    message: 'List local and mobile cloud-synced projects in Instagram Edits.',
  }),
  msg({
    id: 'Open an Instagram Edits project and read its canvas, video clips, timeline elements, captions and licensed music status.',
    message:
      'Open an Instagram Edits project and read its canvas, video clips, timeline elements, captions and licensed music status.',
  }),
  msg({
    id: 'Stage a finished Taalcut render or library asset into a new Instagram Edits project with an optional Instagram audioAssetId and separate editable caption tracks.',
    message:
      'Stage a finished Taalcut render or library asset into a new Instagram Edits project with an optional Instagram audioAssetId and separate editable caption tracks.',
  }),
  msg({
    id: 'Export an Instagram Edits project to a portable .mcomp archive.',
    message: 'Export an Instagram Edits project to a portable .mcomp archive.',
  }),
  msg({
    id: 'Import a .mcomp archive into Instagram Edits as a new project.',
    message: 'Import a .mcomp archive into Instagram Edits as a new project.',
  }),
  msg({
    id: 'Describe a clip in the open Edits project using on-device MetaAISceneX (captions, topics, vibes and aesthetic score).',
    message:
      'Describe a clip in the open Edits project using on-device MetaAISceneX (captions, topics, vibes and aesthetic score).',
  }),
  msg({
    id: 'Track an object described in words across a clip using on-device SAM 3, optionally creating a masked subject cutout.',
    message:
      'Track an object described in words across a clip using on-device SAM 3, optionally creating a masked subject cutout.',
  }),
  msg({
    id: 'Analyze a clip or media item in Edits for note onsets, tempo, 12-bin chroma chords, pauses, quiet cut points and LUFS loudness.',
    message:
      'Analyze a clip or media item in Edits for note onsets, tempo, 12-bin chroma chords, pauses, quiet cut points and LUFS loudness.',
  }),
  msg({
    id: 'Apply Instagram Edits Voice Enhance (noise reduction and voice isolation) and loudness normalization to a clip.',
    message:
      'Apply Instagram Edits Voice Enhance (noise reduction and voice isolation) and loudness normalization to a clip.',
  }),
];
