// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { PluginTool } from '@taalcut/core';

export const INSTAGRAM_EDITS_TOOLS: readonly PluginTool[] = [
  {
    name: 'api.appState',
    description: 'Read the current Instagram Edits screen (home, editor or loading) and active state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    access: ['projects-read'],
    sideEffect: 'read',
    source: 'api',
  },
  {
    name: 'api.browseMusicCategories',
    description:
      'List Instagram Edits music feed categories (For You, Trending, Original audio, Royalty-free) and track counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    access: ['music-read', 'projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.listMusicTracks',
    description:
      'List or search Instagram music tracks by tab (Trending, For You, Original audio, Royalty-free) and license, including audioAssetId and viral hook timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'Music feed tab.' },
        query: { type: 'string', description: 'Optional search query.' },
        license: {
          type: 'string',
          enum: ['any', 'royaltyFree', 'licensed'],
          description: 'Optional license filter.',
        },
      },
      additionalProperties: false,
    },
    access: ['music-read', 'projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.getSavedTracks',
    description: 'List the signed-in Instagram account’s saved audio tracks from Edits.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    access: ['music-read', 'projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.getMusicTrackDetails',
    description:
      'Read full metadata and highlight segments for an Instagram music track by ID or exact title.',
    inputSchema: {
      type: 'object',
      properties: {
        track: { type: 'string', description: 'Track identifier or exact title.' },
      },
      required: ['track'],
      additionalProperties: false,
    },
    access: ['music-read', 'projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.favoriteMusicTrack',
    description: 'Bookmark an Instagram music track into the account’s Saved audio tab.',
    inputSchema: {
      type: 'object',
      properties: {
        track: { type: 'string', description: 'Track identifier or exact title.' },
      },
      required: ['track'],
      additionalProperties: false,
    },
    access: ['projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.searchSoundEffects',
    description: 'Search the Instagram Edits sound-effects catalog by query or category.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional sound-effect search query.' },
        category: { type: 'string', description: 'Optional sound-effect category.' },
      },
      additionalProperties: false,
    },
    access: ['music-read', 'projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.listProjects',
    description: 'List local and mobile cloud-synced projects in Instagram Edits.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    access: ['projects-read'],
    sideEffect: 'read',
    source: 'api',
  },
  {
    name: 'api.inspectProject',
    description:
      'Open an Instagram Edits project and read its canvas, video clips, timeline elements, captions and licensed music status.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Project ID.' },
        name: { type: 'string', description: 'Optional project name.' },
        closeAfter: {
          type: 'boolean',
          description: 'Close the project after inspection if opened from home.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    access: ['projects-read', 'projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.stageReel',
    description:
      'Stage a finished Taalcut render or library asset into a new Instagram Edits project with an optional Instagram audioAssetId and separate editable caption tracks.',
    inputSchema: {
      type: 'object',
      properties: {
        renderId: { type: 'string', description: 'Completed Taalcut render ID.' },
        assetId: { type: 'string', description: 'Taalcut library asset ID.' },
        expectedSha256: { type: 'string', description: 'Optional SHA-256 verification digest.' },
        title: { type: 'string', description: 'Optional project title.' },
        aspectRatio: { type: 'string', description: 'Optional canvas aspect ratio (e.g. 9:16).' },
        frameRate: { type: 'number', description: 'Optional canvas frame rate.' },
        audioAssetId: { type: 'string', description: 'Optional Instagram audio asset ID.' },
        audioTrackTitle: {
          type: 'string',
          description: 'Optional display title for the attached audio track.',
        },
        duckAudio: { type: 'boolean', description: 'Whether to enable audio ducking on the attached song.' },
        videoVolume: { type: 'number', description: 'Optional volume for the staged main video clip.' },
        captions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              startTime: { type: 'number' },
              duration: false,
              preset: { type: 'string' },
              animation: { type: 'string' },
            },
            required: ['text'],
            additionalProperties: false,
          },
          description:
            'Optional editable text layers using Edits default duration; explicit duration is unsupported.',
        },
        generateAutoCaptions: {
          type: 'boolean',
          description: 'Whether to trigger Instagram Edits automatic caption generation.',
        },
      },
      additionalProperties: false,
    },
    access: ['projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.exportMcomp',
    description: 'Export an Instagram Edits project to a portable .mcomp archive.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Project ID.' },
        path: { type: 'string', description: 'Optional output file path.' },
        returnBytes: { type: 'boolean', description: 'Whether to return base64 archive bytes.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    access: ['projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.importMcomp',
    description: 'Import a .mcomp archive into Instagram Edits as a new project.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to .mcomp archive.' },
        archiveBase64: { type: 'string', description: 'Base64-encoded .mcomp archive.' },
      },
      additionalProperties: false,
    },
    access: ['projects-write'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.describeClip',
    description:
      'Describe a clip in the open Edits project using on-device MetaAISceneX (captions, topics, vibes and aesthetic score).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Clip ID.' },
        frames: { type: 'number', description: 'Optional frame sample count.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    access: ['ai-coprocessor'],
    sideEffect: 'read',
    source: 'api',
  },
  {
    name: 'api.trackObject',
    description:
      'Track an object described in words across a clip using on-device SAM 3, optionally creating a masked subject cutout.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Clip ID.' },
        prompt: { type: 'string', description: 'Text prompt describing the target object.' },
        sampleEvery: { type: 'number', description: 'Optional frame sampling interval.' },
        saveMasks: { type: 'boolean', description: 'Whether to persist segmentation masks.' },
        createCutoutSticker: {
          type: 'boolean',
          description: 'Whether to add a cutout sticker from the mask.',
        },
      },
      required: ['id', 'prompt'],
      additionalProperties: false,
    },
    access: ['ai-coprocessor'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.analyzeAudio',
    description:
      'Analyze a clip or media item in Edits for note onsets, tempo, 12-bin chroma chords, pauses, quiet cut points and LUFS loudness.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Clip or media ID.' },
        path: { type: 'string', description: 'Optional media path.' },
        start: { type: 'number', description: 'Optional start time in seconds.' },
        duration: { type: 'number', description: 'Optional duration in seconds.' },
        includeChords: { type: 'boolean', description: 'Whether to compute 12-bin chroma chords.' },
        includePauses: { type: 'boolean', description: 'Whether to detect speech pauses and quiet points.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    access: ['ai-coprocessor'],
    sideEffect: 'read',
    source: 'api',
  },
  {
    name: 'api.enhanceAudio',
    description:
      'Apply Instagram Edits Voice Enhance (noise reduction and voice isolation) and loudness normalization to a clip.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Clip ID.' },
        reduceNoise: { type: 'number', description: 'Noise reduction intensity (0..1).' },
        enhanceVoice: { type: 'number', description: 'Voice isolation intensity (0..1).' },
        volumeDb: { type: 'number', description: 'Optional gain adjustment in dB.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    access: ['ai-coprocessor'],
    sideEffect: 'external',
    source: 'api',
  },
];
