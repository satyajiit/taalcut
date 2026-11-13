// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import type { PluginManifest, PluginSkillContent } from '@taalcut/core';

export const INSTAGRAM_EDITS_DEFAULT_URL = 'http://127.0.0.1:19501/mcp';

function isLocalOrLanHost(host: string): boolean {
  const name = host.toLowerCase();
  if (['localhost', '[::1]', '127.0.0.1'].includes(name)) return true;
  if (name.endsWith('.ts.net') || name.endsWith('.local') || name.endsWith('.localhost')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
  const numbers = name.split('.').map(Number);
  if (numbers.length !== 4 || numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = numbers;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127)
  );
}

export const instagramEditsConfigSchema = z
  .object({
    'mcp-url': z.string().default(INSTAGRAM_EDITS_DEFAULT_URL),
  })
  .strict()
  .transform((config, ctx): Record<string, string> => {
    try {
      const url = new URL(config['mcp-url']);
      if (url.username || url.password || url.search || url.hash) {
        ctx.addIssue({
          code: 'custom',
          message: 'Instagram Edits MCP URL must not contain credentials or query parameters.',
        });
        return z.NEVER;
      }
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalOrLanHost(url.hostname))) {
        ctx.addIssue({
          code: 'custom',
          message: 'Use https:// or a local/LAN http:// address for Instagram Edits.',
        });
        return z.NEVER;
      }
      const pathname = url.pathname.replace(/\/+$/, '') || '/mcp';
      return {
        'mcp-url': `${url.origin}${pathname}`,
      };
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide a valid Instagram Edits MCP URL (e.g. http://127.0.0.1:19501/mcp).',
      });
      return z.NEVER;
    }
  });

export const instagramEditsManifest: PluginManifest = {
  id: 'instagram-edits',
  name: 'Instagram Edits',
  version: '1.0.0',
  publisher: 'Taalcut',
  summary: 'Sync trending Instagram audio, mobile Edits drafts and stage Reels for native publishing.',
  description:
    'Connect the Instagram Edits app over its local MCP server to browse live Trending and Saved audio, ' +
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
      access: ['music-read', 'projects-write'],
    },
    {
      id: 'cloud-drafts',
      name: 'Cloud drafts and templates',
      description:
        'Read mobile cloud-synced Edits projects, cuts, captions and beat markers to build reusable templates.',
      access: ['projects-read', 'projects-write'],
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
      description:
        'List local and cloud-synced Edits projects and inspect their clips, captions and beat markers.',
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

export const instagramEditsSkills: readonly PluginSkillContent[] = [
  {
    ...instagramEditsManifest.skills[0]!,
    content: `# Sync trending Instagram audio
Use \`plugins.describe\` and \`plugins.listTools\` for \`instagram-edits\`. If the plugin is inactive or missing \`music-read\` or \`projects-write\`, call \`plugins.requestSetup\` and direct the user to the plugin settings page. Never ask for tokens in chat.

Music wrappers may create and close a project when Edits is on its home screen, so they require external-action approval and project-write access.\n\n1. Call \`api.browseMusicCategories\` (\`plugins.callExternal\`) to inspect available tabs (\`Trending\`, \`For You\`, \`Original audio\`, \`Royalty-free\`) or \`api.getSavedTracks\` (\`plugins.callExternal\`) to read the creator's saved Instagram audio.
2. Call \`api.listMusicTracks\` (\`plugins.callExternal\`) with \`tab\` and optional \`query\` or \`license\`. Inspect each track's \`audioAssetId\`, \`durationSeconds\`, and \`highlights\` / \`highlightSegments\` (viral hook timestamps).
3. Call \`api.getMusicTrackDetails\` (\`plugins.callExternal\`) for full highlight segments, or \`api.favoriteMusicTrack\` (\`plugins.callExternal\`) to bookmark a track into Saved audio.
4. Preserve the selected \`audioAssetId\` so \`api.stageReel\` can attach the official Instagram audio track during native publishing.`,
  },
  {
    ...instagramEditsManifest.skills[1]!,
    content: `# Stage Reels in Instagram Edits
Stage finished Taalcut renders into Instagram Edits with clean video, official Instagram audio attribution, and editable native caption layers.

1. Render a clean video in Taalcut (without burned-in licensed music or flattened text when native translation is desired) to obtain a verified \`renderId\` or library \`assetId\`.
2. Call \`api.stageReel\` (\`plugins.callExternal\`) with \`renderId\` (or \`assetId\`), \`title\`, optional \`audioAssetId\` and \`duckAudio: true\`, and \`captions\` (each with \`text\`, \`startTime\`, optional \`preset\` and \`animation\`; Edits default duration is used and explicit duration is rejected) or \`generateAutoCaptions: true\`.
3. Taalcut resolves the verified media path in main, creates the Edits project, attaches the licensed Instagram audio track, and places editable text layers so the creator can click **Share to Instagram** with Collaborators, Linked Reels, and Meta AI Voice/Sticker Translation.`,
  },
  {
    ...instagramEditsManifest.skills[2]!,
    content: `# Import Edits drafts and run Meta AI
Use Instagram Edits as a bridge for mobile cloud drafts and on-device Meta AI vision and audio processing.

1. Call \`api.listProjects\` (\`plugins.callRead\`) to discover local and cloud-synced mobile Edits drafts.
2. Inspection changes the active external project and requires project-write access and external-action approval. Call \`api.inspectProject\` (\`plugins.callExternal\`) with \`id\` and \`closeAfter: true\` to read the project's canvas, clips, timeline elements, captions, and music metadata for conversion into a reusable Taalcut Template.
3. With an open project and \`ai-coprocessor\` access, call \`api.describeClip\` (\`plugins.callRead\`) for \`MetaAISceneX\` aesthetic and vibe scores, \`api.trackObject\` (\`plugins.callExternal\`) for SAM 3 text-prompted object tracking and cutout stickers, \`api.analyzeAudio\` (\`plugins.callRead\`) for onsets, chords, pauses, and LUFS loudness, or \`api.enhanceAudio\` (\`plugins.callExternal\`) for Voice Enhance noise reduction and voice isolation.`,
  },
];
