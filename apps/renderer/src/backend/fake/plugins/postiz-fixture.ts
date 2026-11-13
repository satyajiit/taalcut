// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Mirrors the bundled manifest for the renderer's offline preview; no provider code runs here.
/* eslint-disable lingui/no-unlocalized-strings -- provider metadata; the page translates the bundled entries */
import type { PluginManifest } from '@taalcut/core';

export const POSTIZ_API_URL = 'https://api.postiz.com/public/v1';
export const INSTAGRAM_EDITS_DEFAULT_URL = 'http://127.0.0.1:19501/mcp';

export const FAKE_INSTAGRAM_EDITS_MANIFEST: PluginManifest = {
  id: 'instagram-edits',
  name: 'Instagram Edits',
  version: '1.0.0',
  publisher: 'Taalcut',
  summary: 'Sync trending Instagram audio, mobile Edits drafts and stage Reels for native publishing.',
  description:
    'Connect the Instagram Edits macOS app over its local MCP server to browse live Trending and Saved audio, ' +
    'inspect mobile cloud drafts, run on-device Meta AI scene and SAM 3 tools, and stage finished Reels with ' +
    'attached Instagram audio and editable captions.',
  logo: 'instagram-edits',
  homepage: 'https://creators.instagram.com/edits',
  docs: 'https://help.instagram.com/edits',
  features: [
    {
      id: 'trending-audio',
      name: 'Trending and saved audio',
      description: 'Browse Instagram Trending, For You, Original and Saved audio with viral hook timestamps.',
      access: ['music-read'],
    },
    {
      id: 'cloud-drafts',
      name: 'Cloud drafts and templates',
      description:
        'Read mobile cloud-synced Edits projects, cuts, captions and beat markers to build reusable templates.',
      access: ['projects-read'],
    },
    {
      id: 'stage-publish',
      name: 'Stage for Instagram publishing',
      description:
        'Create ready-to-share Edits projects with clean video, attached Instagram audio IDs and editable captions.',
      access: ['projects-read', 'projects-write'],
    },
    {
      id: 'ai-coprocessor',
      name: 'Meta AI and audio co-processor',
      description:
        'Run on-device MetaAISceneX vibe scoring, SAM 3 object cutout tracking and Voice Enhance audio processing.',
      access: ['ai-coprocessor'],
    },
    {
      id: 'mcp',
      name: 'MCP tools',
      description: 'Discover additional tools offered by your Instagram Edits app.',
      access: ['mcp-extended'],
    },
  ],
  access: [
    {
      id: 'music-read',
      name: 'Read trending and saved audio',
      description: 'Browse Instagram music feeds, saved audio tracks, hook timestamps and sound effects.',
    },
    {
      id: 'projects-read',
      name: 'Read Edits projects',
      description: 'List local and cloud-synced Edits projects and inspect their clips, captions and beat markers.',
    },
    {
      id: 'projects-write',
      name: 'Stage projects and bookmark audio',
      description:
        'Create staged Edits projects from Taalcut renders, bookmark saved audio and import or export .mcomp archives.',
    },
    {
      id: 'ai-coprocessor',
      name: 'Run Meta AI and audio tools',
      description:
        'Run on-device MetaAISceneX clip descriptions, SAM 3 subject cutouts and Voice Enhance audio processing.',
    },
    {
      id: 'mcp-extended',
      name: 'Additional MCP capabilities',
      description:
        'Allow new server tools not yet classified by Taalcut. Every call requires external-action approval.',
    },
  ],
  credentials: [
    {
      id: 'access-token',
      name: 'Automation access token',
      description:
        'In Instagram Edits, open Settings → Automation, copy the Access token, then import it from the clipboard.',
      required: true,
    },
  ],
  configFields: [
    {
      id: 'mcp-url',
      name: 'Edits MCP URL',
      description:
        'Local Streamable HTTP MCP endpoint shown in Edits Settings → Automation (default http://127.0.0.1:19501/mcp).',
      kind: 'url',
      defaultValue: INSTAGRAM_EDITS_DEFAULT_URL,
      required: true,
    },
  ],
  skills: [
    {
      id: 'trending-audio',
      name: 'Sync trending Instagram audio',
      description: 'Find trending or saved Instagram audio and align cuts to its viral hook timestamps.',
    },
    {
      id: 'stage-to-edits',
      name: 'Stage Reels in Instagram Edits',
      description:
        'Send a finished video, Instagram audio ID and editable caption tracks into Edits for native publishing.',
    },
    {
      id: 'edits-drafts-and-ai',
      name: 'Import Edits drafts and run Meta AI',
      description:
        'Turn mobile Edits drafts into Taalcut templates and use SAM 3 cutouts or MetaAISceneX analysis.',
    },
  ],
};

export const FAKE_POSTIZ_MANIFEST: PluginManifest = {
  id: 'postiz',
  name: 'Postiz',
  version: '1.0.0',
  publisher: 'Taalcut',
  summary: 'Publish, schedule and measure your social content.',
  description:
    'Connect Postiz Cloud or your own instance to manage channels, posts, media and analytics. ' +
    'Your assistant can use the public API and the MCP tools your instance exposes, guided by bundled skills.',
  logo: 'postiz',
  homepage: 'https://postiz.com',
  docs: 'https://docs.postiz.com/public-api/introduction',
  features: [
    {
      id: 'publishing',
      name: 'Publishing',
      description: 'Draft, schedule, update and delete social posts.',
      access: ['posts-read', 'posts-write'],
    },
    {
      id: 'channels',
      name: 'Channels',
      description: 'Discover accounts, platform rules, groups and available posting slots.',
      access: ['channels-read', 'channels-write'],
    },
    {
      id: 'analytics',
      name: 'Analytics',
      description: 'Read channel and post performance and recover missing published links.',
      access: ['analytics-read', 'posts-write'],
    },
    {
      id: 'media',
      name: 'Media',
      description: 'Upload and find media, generate videos and images, and create clips.',
      access: ['media-read', 'media-write', 'media-generate'],
    },
    {
      id: 'mcp',
      name: 'MCP tools',
      description: 'Discover additional tools offered by your Postiz server.',
      access: ['mcp-extended'],
    },
  ],
  access: [
    {
      id: 'channels-read',
      name: 'Read channels',
      description: 'Read connected accounts, groups, settings and posting slots.',
    },
    {
      id: 'channels-write',
      name: 'Manage channels',
      description: 'Connect or delete channels and invoke platform helpers.',
    },
    {
      id: 'posts-read',
      name: 'Read posts',
      description: 'Read posts, publishing notifications and missing content.',
    },
    {
      id: 'posts-write',
      name: 'Manage and publish posts',
      description: 'Create, publish, schedule, update and delete posts.',
    },
    {
      id: 'analytics-read',
      name: 'Read analytics',
      description: 'Read performance metrics for accounts and published posts.',
    },
    {
      id: 'media-read',
      name: 'Read media',
      description: 'Search uploaded media and check processing and clipping status.',
    },
    {
      id: 'media-write',
      name: 'Upload media',
      description: 'Send files or remote media URLs to your Postiz instance.',
    },
    {
      id: 'media-generate',
      name: 'Generate media',
      description: 'Use Postiz image, video and clipping features, which may consume credits.',
    },
    {
      id: 'mcp-extended',
      name: 'Additional MCP capabilities',
      description:
        'Allow new server tools not yet classified by Taalcut. Every call requires external-action approval.',
    },
  ],
  credentials: [
    {
      id: 'api-key',
      name: 'API key',
      description:
        'Copy your key from Postiz Settings → Developers → Public API, then import it from the clipboard.',
      required: true,
    },
  ],
  configFields: [
    {
      id: 'api-url',
      name: 'API base URL',
      description:
        'The full Public API base, ending in /public/v1. For a reverse proxy this may include /api/public/v1.',
      kind: 'url',
      defaultValue: POSTIZ_API_URL,
      required: true,
    },
    {
      id: 'mcp-url',
      name: 'MCP URL',
      description:
        'Optional streaming MCP endpoint. Leave blank to derive it from your API base. A self-hosted endpoint must use the same origin.',
      kind: 'url',
      defaultValue: '',
      required: false,
    },
  ],
  skills: [
    {
      id: 'publish',
      name: 'Publish with Postiz',
      description: 'Prepare media, inspect channel rules and publish or schedule accurately.',
    },
    {
      id: 'analyze',
      name: 'Measure and improve',
      description: 'Read performance and resolve missing post analytics.',
    },
  ],
};
