// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';

/** Explicit ids match the bundled provider metadata received over IPC. */
export const PLUGIN_MESSAGES = [
  msg({
    id: 'Publish, schedule and measure your social content.',
    message: 'Publish, schedule and measure your social content.',
  }),
  msg({
    id: 'Connect Postiz Cloud or your own instance to manage channels, posts, media and analytics. Your assistant can use the public API and the MCP tools your instance exposes, guided by bundled skills.',
    message:
      'Connect Postiz Cloud or your own instance to manage channels, posts, media and analytics. Your assistant can use the public API and the MCP tools your instance exposes, guided by bundled skills.',
  }),
  msg({ id: 'Publishing', message: 'Publishing' }),
  msg({
    id: 'Draft, schedule, update and delete social posts.',
    message: 'Draft, schedule, update and delete social posts.',
  }),
  msg({ id: 'Channels', message: 'Channels' }),
  msg({
    id: 'Discover accounts, platform rules, groups and available posting slots.',
    message: 'Discover accounts, platform rules, groups and available posting slots.',
  }),
  msg({ id: 'Analytics', message: 'Analytics' }),
  msg({
    id: 'Read channel and post performance and recover missing published links.',
    message: 'Read channel and post performance and recover missing published links.',
  }),
  msg({ id: 'Media', message: 'Media' }),
  msg({
    id: 'Upload and find media, generate videos and images, and create clips.',
    message: 'Upload and find media, generate videos and images, and create clips.',
  }),
  msg({ id: 'MCP tools', message: 'MCP tools' }),
  msg({
    id: 'Discover additional tools offered by your Postiz server.',
    message: 'Discover additional tools offered by your Postiz server.',
  }),
  msg({ id: 'Read channels', message: 'Read channels' }),
  msg({
    id: 'Read connected accounts, groups, settings and posting slots.',
    message: 'Read connected accounts, groups, settings and posting slots.',
  }),
  msg({ id: 'Manage channels', message: 'Manage channels' }),
  msg({
    id: 'Connect or delete channels and invoke platform helpers.',
    message: 'Connect or delete channels and invoke platform helpers.',
  }),
  msg({ id: 'Read posts', message: 'Read posts' }),
  msg({
    id: 'Read posts, publishing notifications and missing content.',
    message: 'Read posts, publishing notifications and missing content.',
  }),
  msg({ id: 'Manage and publish posts', message: 'Manage and publish posts' }),
  msg({
    id: 'Create, publish, schedule, update and delete posts.',
    message: 'Create, publish, schedule, update and delete posts.',
  }),
  msg({ id: 'Read analytics', message: 'Read analytics' }),
  msg({
    id: 'Read performance metrics for accounts and published posts.',
    message: 'Read performance metrics for accounts and published posts.',
  }),
  msg({ id: 'Read media', message: 'Read media' }),
  msg({
    id: 'Search uploaded media and check processing and clipping status.',
    message: 'Search uploaded media and check processing and clipping status.',
  }),
  msg({ id: 'Upload media', message: 'Upload media' }),
  msg({
    id: 'Send files or remote media URLs to your Postiz instance.',
    message: 'Send files or remote media URLs to your Postiz instance.',
  }),
  msg({ id: 'Generate media', message: 'Generate media' }),
  msg({
    id: 'Use Postiz image, video and clipping features, which may consume credits.',
    message: 'Use Postiz image, video and clipping features, which may consume credits.',
  }),
  msg({ id: 'Additional MCP capabilities', message: 'Additional MCP capabilities' }),
  msg({
    id: 'Allow new server tools not yet classified by Taalcut. Every call requires external-action approval.',
    message:
      'Allow new server tools not yet classified by Taalcut. Every call requires external-action approval.',
  }),
  msg({ id: 'API key', message: 'API key' }),
  msg({
    id: 'Copy your key from Postiz Settings → Developers → Public API, then import it from the clipboard.',
    message:
      'Copy your key from Postiz Settings → Developers → Public API, then import it from the clipboard.',
  }),
  msg({ id: 'API base URL', message: 'API base URL' }),
  msg({
    id: 'The full Public API base, ending in /public/v1. For a reverse proxy this may include /api/public/v1.',
    message:
      'The full Public API base, ending in /public/v1. For a reverse proxy this may include /api/public/v1.',
  }),
  msg({ id: 'MCP URL', message: 'MCP URL' }),
  msg({
    id: 'Optional streaming MCP endpoint. Leave blank to derive it from your API base. A self-hosted endpoint must use the same origin.',
    message:
      'Optional streaming MCP endpoint. Leave blank to derive it from your API base. A self-hosted endpoint must use the same origin.',
  }),
  msg({ id: 'Publish with Postiz', message: 'Publish with Postiz' }),
  msg({
    id: 'Prepare media, inspect channel rules and publish or schedule accurately.',
    message: 'Prepare media, inspect channel rules and publish or schedule accurately.',
  }),
  msg({ id: 'Measure and improve', message: 'Measure and improve' }),
  msg({
    id: 'Read performance and resolve missing post analytics.',
    message: 'Read performance and resolve missing post analytics.',
  }),
  msg({
    id: 'Sync trending Instagram audio, mobile Edits drafts and stage Reels for native publishing.',
    message: 'Sync trending Instagram audio, mobile Edits drafts and stage Reels for native publishing.',
  }),
  msg({
    id: 'Connect the Instagram Edits app over its local MCP server to browse live Trending and Saved audio, inspect mobile cloud drafts, run on-device Meta AI scene and SAM 3 tools, and stage finished Reels with attached Instagram audio and editable captions.',
    message:
      'Connect the Instagram Edits app over its local MCP server to browse live Trending and Saved audio, inspect mobile cloud drafts, run on-device Meta AI scene and SAM 3 tools, and stage finished Reels with attached Instagram audio and editable captions.',
  }),
  msg({ id: 'Trending and saved audio', message: 'Trending and saved audio' }),
  msg({
    id: 'Browse Instagram Trending, For You, Original and Saved audio with viral hook timestamps.',
    message: 'Browse Instagram Trending, For You, Original and Saved audio with viral hook timestamps.',
  }),
  msg({ id: 'Cloud drafts and templates', message: 'Cloud drafts and templates' }),
  msg({
    id: 'Read mobile cloud-synced Edits projects, cuts, captions and beat markers to build reusable templates.',
    message:
      'Read mobile cloud-synced Edits projects, cuts, captions and beat markers to build reusable templates.',
  }),
  msg({ id: 'Stage for Instagram publishing', message: 'Stage for Instagram publishing' }),
  msg({
    id: 'Create ready-to-share Edits projects with clean video, attached Instagram audio IDs and editable captions.',
    message:
      'Create ready-to-share Edits projects with clean video, attached Instagram audio IDs and editable captions.',
  }),
  msg({ id: 'Meta AI and audio co-processor', message: 'Meta AI and audio co-processor' }),
  msg({
    id: 'Run on-device MetaAISceneX vibe scoring, SAM 3 object cutout tracking and Voice Enhance audio processing.',
    message:
      'Run on-device MetaAISceneX vibe scoring, SAM 3 object cutout tracking and Voice Enhance audio processing.',
  }),
  msg({
    id: 'Discover additional tools offered by your Instagram Edits app.',
    message: 'Discover additional tools offered by your Instagram Edits app.',
  }),
  msg({ id: 'Read trending and saved audio', message: 'Read trending and saved audio' }),
  msg({
    id: 'Browse Instagram music feeds, saved audio tracks, hook timestamps and sound effects.',
    message: 'Browse Instagram music feeds, saved audio tracks, hook timestamps and sound effects.',
  }),
  msg({ id: 'Read Edits projects', message: 'Read Edits projects' }),
  msg({
    id: 'List local and cloud-synced Edits projects and inspect their clips, captions and beat markers.',
    message:
      'List local and cloud-synced Edits projects and inspect their clips, captions and beat markers.',
  }),
  msg({ id: 'Stage projects and bookmark audio', message: 'Stage projects and bookmark audio' }),
  msg({
    id: 'Create staged Edits projects from Taalcut renders, bookmark saved audio and import or export .mcomp archives.',
    message:
      'Create staged Edits projects from Taalcut renders, bookmark saved audio and import or export .mcomp archives.',
  }),
  msg({ id: 'Run Meta AI and audio tools', message: 'Run Meta AI and audio tools' }),
  msg({
    id: 'Run on-device MetaAISceneX clip descriptions, SAM 3 subject cutouts and Voice Enhance audio processing.',
    message:
      'Run on-device MetaAISceneX clip descriptions, SAM 3 subject cutouts and Voice Enhance audio processing.',
  }),
  msg({ id: 'Automation access token', message: 'Automation access token' }),
  msg({
    id: 'In Instagram Edits, open Settings → Automation, copy the Access token, then import it from the clipboard.',
    message:
      'In Instagram Edits, open Settings → Automation, copy the Access token, then import it from the clipboard.',
  }),
  msg({ id: 'Edits MCP URL', message: 'Edits MCP URL' }),
  msg({
    id: 'Local Streamable HTTP MCP endpoint shown in Edits Settings → Automation (default http://127.0.0.1:19501/mcp).',
    message:
      'Local Streamable HTTP MCP endpoint shown in Edits Settings → Automation (default http://127.0.0.1:19501/mcp).',
  }),
  msg({ id: 'Sync trending Instagram audio', message: 'Sync trending Instagram audio' }),
  msg({
    id: 'Find trending or saved Instagram audio and align cuts to its viral hook timestamps.',
    message: 'Find trending or saved Instagram audio and align cuts to its viral hook timestamps.',
  }),
  msg({ id: 'Stage Reels in Instagram Edits', message: 'Stage Reels in Instagram Edits' }),
  msg({
    id: 'Send a finished video, Instagram audio ID and editable caption tracks into Edits for native publishing.',
    message:
      'Send a finished video, Instagram audio ID and editable caption tracks into Edits for native publishing.',
  }),
  msg({ id: 'Import Edits drafts and run Meta AI', message: 'Import Edits drafts and run Meta AI' }),
  msg({
    id: 'Turn mobile Edits drafts into Taalcut templates and use SAM 3 cutouts or MetaAISceneX analysis.',
    message:
      'Turn mobile Edits drafts into Taalcut templates and use SAM 3 cutouts or MetaAISceneX analysis.',
  }),
];
