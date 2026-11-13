// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type AsyncResult, type PluginTool } from '@taalcut/core';
import { PluginAuthenticationFailed, PluginInvalidInput, PluginInvalidTool } from './errors';
import {
  instagramEditsConfigSchema,
  instagramEditsManifest,
  instagramEditsSkills,
} from './instagram-edits-manifest';
import {
  connectInstagramEditsMcp,
  createInstagramEditsSession,
  type ResolvePluginMediaPath,
} from './instagram-edits-session';
import { INSTAGRAM_EDITS_TOOLS } from './instagram-edits-tools';
import type { PluginMcpConnector, PluginMcpTool } from './mcp-client';
import type { PluginDefinition } from './provider';
import { pluginAttempt } from './safe-result';

export type { ResolvePluginMediaPath } from './instagram-edits-session';

const PLUGIN_ID = 'instagram-edits';

export interface InstagramEditsPluginOptions {
  readonly fetch?: typeof fetch;
  readonly connectMcp?: PluginMcpConnector;
  readonly resolveMediaPath?: ResolvePluginMediaPath;
}

function mcpTool(tool: PluginMcpTool): PluginTool {
  const schema =
    tool.inputSchema && typeof tool.inputSchema === 'object' && 'type' in tool.inputSchema
      ? tool.inputSchema
      : { type: 'object', properties: {}, additionalProperties: true };
  return {
    name: `mcp.${tool.name}`,
    description: tool.description?.slice(0, 4000) || tool.name,
    inputSchema: schema,
    access: ['mcp-extended'],
    sideEffect: 'external',
    source: 'mcp',
  };
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function runCoProcessorTool(
  name: string,
  input: Record<string, unknown>,
  session: ReturnType<typeof createInstagramEditsSession>,
  signal: AbortSignal,
): AsyncResult<unknown> {
  const id = nonEmptyString(input['id']);
  if (!id) {
    return err(PluginInvalidInput({ pluginId: PLUGIN_ID }, { detail: 'Clip id is required.' }));
  }

  if (name === 'api.describeClip') {
    const frames = typeof input['frames'] === 'number' ? input['frames'] : undefined;
    return session.callMcp('describeClip', { id, ...(frames !== undefined ? { frames } : {}) }, signal);
  }

  if (name === 'api.trackObject') {
    const prompt = nonEmptyString(input['prompt']);
    if (!prompt) {
      return err(PluginInvalidInput({ pluginId: PLUGIN_ID }, { detail: 'Object prompt is required.' }));
    }
    const sampleEvery = typeof input['sampleEvery'] === 'number' ? input['sampleEvery'] : undefined;
    const saveMasks = typeof input['saveMasks'] === 'boolean' ? input['saveMasks'] : undefined;
    const tracked = await session.callMcp(
      'trackObject',
      {
        id,
        prompt,
        ...(sampleEvery !== undefined ? { sampleEvery } : {}),
        ...(saveMasks !== undefined ? { saveMasks } : {}),
      },
      signal,
    );
    if (!tracked.ok || input['createCutoutSticker'] !== true) return tracked;
    const sticker = await session.callMcp('addStickerFromCutout', { id, prompt }, signal);
    if (!sticker.ok) return sticker;
    return ok({
      ...(tracked.value && typeof tracked.value === 'object'
        ? (tracked.value as Record<string, unknown>)
        : { tracking: tracked.value }),
      cutoutSticker: sticker.value,
    });
  }

  if (name === 'api.analyzeAudio') {
    const path = nonEmptyString(input['path']);
    const start = typeof input['start'] === 'number' ? input['start'] : undefined;
    const duration = typeof input['duration'] === 'number' ? input['duration'] : undefined;
    const baseArgs: Record<string, unknown> = {
      id,
      ...(path ? { path } : {}),
      ...(start !== undefined ? { start } : {}),
      ...(duration !== undefined ? { duration } : {}),
    };
    const clipOnlyArgs: Record<string, unknown> = { id, ...(path ? { path } : {}) };
    const onsets = await session.callMcp('audioOnsets', baseArgs, signal);
    if (!onsets.ok) return onsets;
    const loudness = await session.callMcp('loudness', clipOnlyArgs, signal);
    if (!loudness.ok) return loudness;
    let chordsValue: unknown;
    if (input['includeChords'] !== false) {
      const chords = await session.callMcp('audioChords', baseArgs, signal);
      if (!chords.ok) return chords;
      chordsValue = chords.value;
    }
    let pausesValue: unknown;
    let quietPointValue: unknown;
    if (input['includePauses'] !== false) {
      const pauses = await session.callMcp('findPauses', clipOnlyArgs, signal);
      if (!pauses.ok) return pauses;
      pausesValue = pauses.value;
      const quiet = await session.callMcp('quietPoint', baseArgs, signal);
      if (!quiet.ok) return quiet;
      quietPointValue = quiet.value;
    }
    return ok({
      id,
      onsets: onsets.value,
      loudness: loudness.value,
      ...(chordsValue !== undefined ? { chords: chordsValue } : {}),
      ...(pausesValue !== undefined ? { pauses: pausesValue } : {}),
      ...(quietPointValue !== undefined ? { quietPoint: quietPointValue } : {}),
    });
  }

  if (name === 'api.enhanceAudio') {
    const reduceNoise = typeof input['reduceNoise'] === 'number' ? input['reduceNoise'] : undefined;
    const enhanceVoice = typeof input['enhanceVoice'] === 'number' ? input['enhanceVoice'] : undefined;
    const volumeDb = typeof input['volumeDb'] === 'number' ? input['volumeDb'] : undefined;
    const processed = await session.callMcp(
      'processAudio',
      {
        id,
        ...(reduceNoise !== undefined ? { reduceNoise } : {}),
        ...(enhanceVoice !== undefined ? { enhanceVoice } : {}),
      },
      signal,
    );
    if (!processed.ok || volumeDb === undefined) return processed;
    const sound = await session.callMcp('setSound', { id, volumeDb }, signal);
    if (!sound.ok) return sound;
    return ok({
      id,
      audio: processed.value,
      sound: sound.value,
    });
  }

  return err(PluginInvalidTool({ pluginId: PLUGIN_ID }));
}

export function createInstagramEditsPluginDefinition(
  options: InstagramEditsPluginOptions = {},
): PluginDefinition {
  const fetchImpl = options.fetch ?? fetch;
  const connectImpl = options.connectMcp ?? connectInstagramEditsMcp;

  return {
    manifest: instagramEditsManifest,
    skills: instagramEditsSkills,
    configSchema: instagramEditsConfigSchema,
    create(context) {
      let session: ReturnType<typeof createInstagramEditsSession> | undefined;

      return {
        async connect(signal) {
          const credential = await context.secrets.get('access-token');
          if (!credential.ok) return credential;
          if (!credential.value) return err(PluginAuthenticationFailed({ pluginId: PLUGIN_ID }));

          const remote = await connectImpl({
            url: context.config['mcp-url']!,
            token: credential.value,
            fetch: fetchImpl,
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          });
          if (!remote.ok) return remote;

          session = createInstagramEditsSession(remote.value);
          return ok([...INSTAGRAM_EDITS_TOOLS, ...session.tools.map(mcpTool)]);
        },

        async invoke(name, input, signal) {
          if (!session) return err(PluginAuthenticationFailed({ pluginId: PLUGIN_ID }));
          const active = session;

          return pluginAttempt(PLUGIN_ID, signal, async () => {
            if (name.startsWith('mcp.')) {
              return active.callMcp(name.slice(4), input, signal);
            }
            if (name === 'api.appState') {
              return active.callMcp('appState', {}, signal);
            }
            if (name === 'api.browseMusicCategories') {
              return active.withEditorScreen(signal, () =>
                active.callMcp('browseMusicCategories', {}, signal),
              );
            }
            if (name === 'api.listMusicTracks') {
              const tab = nonEmptyString(input['tab']);
              const query = nonEmptyString(input['query']);
              const license = nonEmptyString(input['license']);
              return active.withEditorScreen(signal, () =>
                active.callMcp(
                  'listMusicTracks',
                  {
                    ...(tab ? { tab } : {}),
                    ...(query ? { query } : {}),
                    ...(license ? { license } : {}),
                  },
                  signal,
                ),
              );
            }
            if (name === 'api.getSavedTracks') {
              return active.withEditorScreen(signal, () => active.callMcp('getSavedTracks', {}, signal));
            }
            if (name === 'api.getMusicTrackDetails') {
              const track = nonEmptyString(input['track']);
              if (!track || 'preview' in input) return err(PluginInvalidInput({ pluginId: PLUGIN_ID }));
              return active.withEditorScreen(signal, () =>
                active.callMcp('getMusicTrackDetails', { track }, signal),
              );
            }
            if (name === 'api.favoriteMusicTrack') {
              const track = nonEmptyString(input['track']);
              if (!track) return err(PluginInvalidInput({ pluginId: PLUGIN_ID }));
              return active.withEditorScreen(signal, () =>
                active.callMcp('favoriteMusicTrack', { track }, signal),
              );
            }
            if (name === 'api.searchSoundEffects') {
              const query = nonEmptyString(input['query']);
              const category = nonEmptyString(input['category']);
              return active.withEditorScreen(signal, () =>
                active.callMcp(
                  'searchSoundEffects',
                  {
                    ...(query ? { query } : {}),
                    ...(category ? { category } : {}),
                  },
                  signal,
                ),
              );
            }
            if (name === 'api.listProjects') {
              const listed = await active.callMcp('listProjects', {}, signal);
              if (listed.ok) return listed;
              return active.callMcp('projects', {}, signal);
            }
            if (name === 'api.inspectProject') {
              return active.inspectProject(input, signal);
            }
            if (name === 'api.stageReel') {
              return active.stageReel(input, options.resolveMediaPath, signal);
            }
            if (name === 'api.exportMcomp') {
              const id = nonEmptyString(input['id']);
              if (!id) return err(PluginInvalidInput({ pluginId: PLUGIN_ID }));
              const path = nonEmptyString(input['path']);
              const returnBytes =
                typeof input['returnBytes'] === 'boolean' ? input['returnBytes'] : undefined;
              return active.callMcp(
                'exportMcomp',
                {
                  id,
                  ...(path ? { path } : {}),
                  ...(returnBytes !== undefined ? { returnBytes } : {}),
                },
                signal,
              );
            }
            if (name === 'api.importMcomp') {
              const path = nonEmptyString(input['path']);
              const archiveBase64 = nonEmptyString(input['archiveBase64']);
              if (!path && !archiveBase64) return err(PluginInvalidInput({ pluginId: PLUGIN_ID }));
              return active.callMcp(
                'importMcomp',
                {
                  ...(path ? { path } : {}),
                  ...(archiveBase64 ? { archiveBase64 } : {}),
                },
                signal,
              );
            }
            if (
              name === 'api.describeClip' ||
              name === 'api.trackObject' ||
              name === 'api.analyzeAudio' ||
              name === 'api.enhanceAudio'
            ) {
              return runCoProcessorTool(name, input, active, signal);
            }
            return err(PluginInvalidTool({ pluginId: PLUGIN_ID }));
          });
        },

        async dispose() {
          const previous = session;
          session = undefined;
          await previous?.close();
        },
      };
    },
  };
}

export const instagramEditsPluginDefinition = createInstagramEditsPluginDefinition();
