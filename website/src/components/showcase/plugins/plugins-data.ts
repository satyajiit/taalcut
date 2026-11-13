// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Plugins and Settings › External agents, in the app's own words (apps/renderer/src/features/settings/
 * plugins and external-agents, packages/tools/src/plugins/{postiz,instagram-edits}-manifest.ts, the approval card in
 * packages/ui/src/cards, at d9ab77925). The build has two plugins, Postiz and Instagram Edits: no store, no third
 * party's plugins. Where a manifest's line says something the site may not (an unfinished post, a word the site
 * keeps off its pages), it is shortened to what stays true. Pure data, so test/unit/showcase-plugins.test.ts can hold
 * it to the truth ledger.
 */

export type PluginId = 'postiz' | 'instagram-edits';
export type PluginViewId = 'connection' | 'access' | 'tools' | 'skills';

/** A plugin's four views, as its page lists them (plugin-views.tsx). */
export const PLUGIN_VIEWS: readonly { readonly id: PluginViewId; readonly label: string }[] = [
  { id: 'connection', label: 'Connection' },
  { id: 'access', label: 'Access' },
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
];

export interface PluginInfo {
  readonly id: PluginId;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly publisher: string;
  readonly version: string;
  /** Where it connects: the address field and its hint. */
  readonly address: { readonly name: string; readonly value: string; readonly hint: string };
  readonly credential: { readonly name: string; readonly description: string };
  /** What the AI may do with it: Access's rows. */
  readonly access: readonly { readonly id: string; readonly name: string; readonly description: string }[];
  /** What it can do: Tools' features. */
  readonly features: readonly { readonly name: string; readonly description: string }[];
  /** The tools the AI can find, and whether each only reads or acts outside Taalcut. */
  readonly tools: readonly { readonly name: string; readonly description: string; readonly effect: 'Read' | 'External action' }[];
  /** The guides it brings, each a few steps. */
  readonly skills: readonly { readonly name: string; readonly description: string; readonly steps: readonly string[] }[];
}

export const PLUGINS: readonly PluginInfo[] = [
  {
    id: 'postiz',
    name: 'Postiz',
    summary: 'Publish, schedule and measure your social content.',
    description: 'Connect Postiz Cloud or your own instance to manage channels, posts, media and analytics.',
    publisher: 'Taalcut',
    version: '1.0.0',
    address: {
      name: 'API base URL',
      value: 'https://api.postiz.com/public/v1',
      hint: 'Use the hosted service or your own instance.',
    },
    credential: {
      name: 'API key',
      description: 'Copy your key from Postiz Settings › Developers › Public API, then import it from the clipboard.',
    },
    access: [
      { id: 'channels-read', name: 'Read channels', description: 'Read connected accounts, groups, settings and posting slots.' },
      { id: 'posts-read', name: 'Read posts', description: 'Read posts and publishing notifications.' },
      { id: 'posts-write', name: 'Manage and publish posts', description: 'Create, publish, schedule, update and delete posts.' },
      { id: 'analytics-read', name: 'Read analytics', description: 'Read performance metrics for accounts and published posts.' },
      { id: 'media-upload', name: 'Upload media', description: 'Send files to your Postiz instance.' },
    ],
    features: [
      { name: 'Publishing', description: 'Schedule, update and delete social posts.' },
      { name: 'Channels', description: 'Discover accounts, platform rules, groups and available posting slots.' },
      { name: 'Analytics', description: 'Read channel and post performance and recover missing published links.' },
      { name: 'Media', description: 'Upload and find media.' },
    ],
    tools: [
      { name: 'api.listIntegrations', description: 'List connected social accounts.', effect: 'Read' },
      { name: 'api.findSlot', description: 'Find the next available posting slot for a channel.', effect: 'Read' },
      { name: 'api.createPost', description: 'Create a scheduled or immediate post. This can publish to social accounts.', effect: 'External action' },
      { name: 'api.getPostAnalytics', description: 'Read published-post metrics.', effect: 'Read' },
    ],
    skills: [
      {
        name: 'Publish with Postiz',
        description: 'Prepare media, inspect channel rules and publish or schedule accurately.',
        steps: [
          'Find your connected channels and read each one’s rules.',
          'Upload the video, then write the post for each channel.',
          'Schedule it or post it, once you approve.',
        ],
      },
      {
        name: 'Measure and improve',
        description: 'Read performance and resolve missing post analytics.',
        steps: ['Read how each channel and each post did.', 'Find a post whose published link is missing, and recover it.'],
      },
    ],
  },
  {
    id: 'instagram-edits',
    name: 'Instagram Edits',
    summary: 'Sync trending Instagram audio and stage Reels for publishing from Edits.',
    description:
      'Connect the Instagram Edits app on this Mac to browse Trending and Saved audio, run its on-device tools, and stage finished Reels with Instagram audio attached and editable captions.',
    publisher: 'Taalcut',
    version: '1.0.0',
    address: {
      name: 'Edits automation URL',
      value: 'http://127.0.0.1:19501/mcp',
      hint: 'The local address shown in Edits › Settings › Automation.',
    },
    credential: {
      name: 'Automation access token',
      description: 'In Instagram Edits, open Settings › Automation, copy the Access token, then import it from the clipboard.',
    },
    access: [
      { id: 'music-read', name: 'Read trending and saved audio', description: 'Browse Instagram music feeds, saved audio, hook timestamps and sound effects.' },
      { id: 'projects-write', name: 'Stage projects and bookmark audio', description: 'Stage your finished videos as Edits projects, and save audio.' },
      { id: 'ai-coprocessor', name: 'Run Meta AI and audio tools', description: 'On-device vibe scores for clips, subject cutouts and Voice Enhance, in Edits.' },
    ],
    features: [
      { name: 'Trending and saved audio', description: 'Browse Trending, For You, Original audio and Saved audio with viral hook timestamps.' },
      { name: 'Stage for Instagram publishing', description: 'Ready-to-share Edits projects with clean video, Instagram audio attached and editable captions.' },
      { name: 'Meta AI and audio co-processor', description: 'On-device vibe scoring of clips, subject cutouts and Voice Enhance.' },
    ],
    tools: [
      { name: 'api.listMusicTracks', description: 'List or search Instagram music by tab and licence, with viral hook timestamps.', effect: 'External action' },
      { name: 'api.favoriteMusicTrack', description: 'Bookmark a track into Saved audio.', effect: 'External action' },
      { name: 'api.describeClip', description: 'Describe a clip on-device, with its vibe score.', effect: 'Read' },
      { name: 'api.stageReel', description: 'Stage a finished video in a new Edits project, with Instagram audio and editable caption tracks.', effect: 'External action' },
    ],
    skills: [
      {
        name: 'Sync trending Instagram audio',
        description: 'Find trending or saved Instagram audio and align cuts to its viral hook timestamps.',
        steps: [
          'Look through Trending, For You, Original audio and Royalty-free, or your Saved audio.',
          'Read each sound’s hook drops, in seconds.',
          'Keep the chosen sound, so it is attached when the video is staged.',
        ],
      },
      {
        name: 'Stage Reels in Instagram Edits',
        description: 'Send a finished video, its Instagram audio and editable caption tracks into Edits.',
        steps: ['Export a clean video in Taalcut.', 'Stage it in Edits with its sound and caption tracks.', 'Post it from Edits.'],
      },
    ],
  },
];

export function pluginById(id: PluginId): PluginInfo {
  return PLUGINS.find((p) => p.id === id) ?? (PLUGINS[0] as PluginInfo);
}

/** The agent apps Taalcut copies the setup for, with where the person pastes it (agent-words.ts). */
export type AgentApp = 'claude-code' | 'codex';
export const AGENT_APPS: readonly { readonly id: AgentApp; readonly name: string; readonly brand: 'claude' | 'codex'; readonly paste: string }[] = [
  { id: 'claude-code', name: 'Claude Code', brand: 'claude', paste: 'Copied. Paste it into a terminal where you use Claude Code.' },
  { id: 'codex', name: 'Codex', brand: 'codex', paste: 'Copied. Paste it into Codex’s config file, ~/.codex/config.toml.' },
];

/** What an agent may do, as the person reads it (LEVEL_WORDS). */
export type AgentLevel = 'read' | 'edit' | 'export';
export const AGENT_LEVELS: readonly { readonly id: AgentLevel; readonly name: string; readonly line: string }[] = [
  { id: 'read', name: 'Look only', line: 'Sees your clips, templates and projects. Changes nothing.' },
  { id: 'edit', name: 'Edit', line: 'Makes changes you can undo. Asks you before anything that costs money.' },
  { id: 'export', name: 'Edit and export', line: 'Also exports videos. Every export still asks you first.' },
];

/** Settings › External agents, its fixed lines. */
export const AGENT_WORDS = {
  switchLabel: 'Let agents on this Mac use Taalcut',
  switchLine:
    'Apps like Claude Code or Codex can search your clips, edit and export, at the level you give each one. Anything that costs money or exports still asks you here.',
  off: 'Off. No agent can reach Taalcut.',
  listening: 'Listening on this Mac only.',
  connectLine: 'Taalcut copies the setup for you. Paste it into your agent, and Taalcut’s tools show up there.',
  key: 'The setup holds a key only this Mac knows. Taalcut keeps it in the keychain and never shows it here.',
  waiting: 'Waiting for it to connect',
  connected: 'Connected',
  revoked: 'Revoked. It can’t act any more.',
} as const;

/** The level an agent has, as three steps lit up to it (Look only is Read; Edit and export reaches Export). */
export const LEVEL_STEPS = ['Read', 'Edit', 'Export'] as const;

/** Claude Code's ask on the approval card (packages/ui/src/cards/approval-card.tsx): what it wants to do. */
export const ASK = {
  summary: 'Export the Vietnam cut for Reels',
  detail: 'A 9:16 MP4 of “Vietnam, walking away on every beat”. Every export still asks you first.',
  approved: 'Approved. Claude Code exports it now.',
  declined: 'Declined. Nothing was exported.',
} as const;

/** The Vietnam cut as a post in Postiz, waiting for your approval. The account is the visitor's own. */
export const POSTIZ_POST = {
  channel: 'Instagram · Reels',
  account: '@yourname',
  words: 'Walking away on every beat. Vietnam, cut on the music.',
  when: 'Saturday, 18:30',
  scheduled: 'Postiz posts it on Saturday at 18:30, then reads how it did.',
} as const;
