// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { boundedPluginResponse } from './bounded-response';
import { PluginAuthenticationFailed, PluginInvalidInput, PluginRemoteFailed } from './errors';
import type { PluginMcpConnector, PluginMcpSession, PluginMcpTool } from './mcp-client';
import type { UploadInput } from './postiz-http';
import { pluginAttempt } from './safe-result';

const PLUGIN_ID = 'instagram-edits';

export type ResolvePluginMediaPath = (input: UploadInput, signal: AbortSignal) => AsyncResult<string>;

export function unwrapEditsMcpValue(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const content = (raw as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return raw;
  const first = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') return raw;
  const trimmed = first.text.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return first.text;
  }
}

async function listEditsTools(client: Client, signal: AbortSignal): AsyncResult<PluginMcpTool[]> {
  const tools: PluginMcpTool[] = [];
  const cursors = new Set<string>();
  const names = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 16; page += 1) {
    const listed = await client.request(
      { method: 'tools/list', params: cursor ? { cursor } : {} },
      { signal },
    );
    for (const tool of listed.tools) {
      if (names.has(tool.name)) return err(PluginRemoteFailed({ pluginId: PLUGIN_ID }));
      names.add(tool.name);
      tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
    }
    if (tools.length > 500) return err(PluginRemoteFailed({ pluginId: PLUGIN_ID }));
    if (!listed.nextCursor) return ok(tools);
    if (cursors.has(listed.nextCursor)) return err(PluginRemoteFailed({ pluginId: PLUGIN_ID }));
    cursor = listed.nextCursor;
    cursors.add(cursor);
  }
  return err(PluginRemoteFailed({ pluginId: PLUGIN_ID }));
}

export const connectInstagramEditsMcp: PluginMcpConnector = (options) =>
  pluginAttempt(PLUGIN_ID, options.signal, async () => {
    const client = new Client({ name: 'taalcut-instagram-edits', version: '1.0.0' }, { listMaxPages: 16 });
    const pinned = new URL(options.url);
    let authFailed = false;
    const transport = new StreamableHTTPClientTransport(pinned, {
      requestInit: { headers: { Authorization: `Bearer ${options.token}` }, redirect: 'error' },
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== pinned.origin || url.pathname !== pinned.pathname) {
          return Promise.reject(new Error('Plugin endpoint changed.'));
        }
        const response = await options.fetch(input, { ...init, redirect: 'error' });
        if (response.status === 401 || response.status === 403) authFailed = true;
        return boundedPluginResponse(
          response,
          init?.signal ?? (input instanceof Request ? input.signal : undefined),
        );
      },
    });
    const abort = () => {
      void client.close().catch(() => undefined);
    };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      await client.connect(transport, { signal: options.signal });
      const listed = await listEditsTools(client, options.signal);
      if (!listed.ok) {
        await client.close();
        return authFailed ? err(PluginAuthenticationFailed({ pluginId: PLUGIN_ID })) : listed;
      }
      return ok({
        tools: listed.value,
        call: (name, input, signal) =>
          pluginAttempt(PLUGIN_ID, signal, async () => {
            if (!name.trim()) return err(PluginInvalidInput({ pluginId: PLUGIN_ID }));
            const result = await client.callTool({ name, arguments: input }, { signal });
            if (result.isError) return err(PluginRemoteFailed({ pluginId: PLUGIN_ID }));
            if (JSON.stringify(result).length > 4_000_000) {
              return err(PluginRemoteFailed({ pluginId: PLUGIN_ID }));
            }
            return ok(unwrapEditsMcpValue(result));
          }),
        close: () => client.close(),
      });
    } catch {
      await client.close().catch(() => undefined);
      return err(
        authFailed
          ? PluginAuthenticationFailed({ pluginId: PLUGIN_ID })
          : PluginRemoteFailed({ pluginId: PLUGIN_ID }),
      );
    } finally {
      options.signal.removeEventListener('abort', abort);
    }
  });

function firstId(value: unknown, arrayKey?: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] === 'string' && record['id']) return record['id'];
  if (typeof record['elementId'] === 'string' && record['elementId']) return record['elementId'];
  const list = Array.isArray(value)
    ? value
    : arrayKey && Array.isArray(record[arrayKey])
      ? (record[arrayKey] as unknown[])
      : undefined;
  const first = list?.[0];
  if (first && typeof first === 'object' && typeof (first as { id?: unknown }).id === 'string') {
    return (first as { id: string }).id;
  }
  return undefined;
}

export function createInstagramEditsSession(mcp: PluginMcpSession) {
  const callMcp = async (
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncResult<unknown> => {
    const result = await mcp.call(name, input, signal);
    return result.ok ? ok(unwrapEditsMcpValue(result.value)) : result;
  };

  const getScreen = async (signal: AbortSignal): AsyncResult<string | undefined> => {
    const state = await callMcp('appState', {}, signal);
    if (!state.ok) return state;
    const screen =
      state.value && typeof state.value === 'object'
        ? (state.value as { screen?: unknown }).screen
        : undefined;
    return ok(typeof screen === 'string' ? screen : undefined);
  };

  const withEditorScreen = async <T>(
    signal: AbortSignal,
    operation: () => AsyncResult<T>,
  ): AsyncResult<T> => {
    const screen = await getScreen(signal);
    if (!screen.ok) return screen;
    if (screen.value !== 'home') return operation();
    const opened = await callMcp('newProject', {}, signal);
    if (!opened.ok) return opened;
    try {
      return await operation();
    } finally {
      await callMcp('closeProject', {}, signal).catch(() => undefined);
    }
  };

  const inspectProject = async (
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncResult<unknown> => {
    const id = typeof input['id'] === 'string' ? input['id'].trim() : '';
    const name = typeof input['name'] === 'string' ? input['name'].trim() : undefined;
    const closeAfter = typeof input['closeAfter'] === 'boolean' ? input['closeAfter'] : undefined;
    if (!id) {
      return err(PluginInvalidInput({ pluginId: PLUGIN_ID }, { detail: 'Project id is required.' }));
    }
    const screen = await getScreen(signal);
    if (!screen.ok) return screen;
    if (screen.value === 'editor') {
      const closed = await callMcp('closeProject', {}, signal);
      if (!closed.ok) return closed;
    }
    const opened = await callMcp('openProject', { id, ...(name ? { name } : {}) }, signal);
    if (!opened.ok) return opened;
    const shouldClose = closeAfter ?? screen.value === 'home';
    try {
      const canvas = await callMcp('getCanvas', {}, signal);
      if (!canvas.ok) return canvas;
      const clips = await callMcp('clips', {}, signal);
      if (!clips.ok) return clips;
      const elements = await callMcp('elements', {}, signal);
      if (!elements.ok) return elements;
      const captions = await callMcp('getCaptions', {}, signal);
      if (!captions.ok) return captions;
      const licensedMusic = await callMcp('hasLicensedMusic', {}, signal);
      if (!licensedMusic.ok) return licensedMusic;
      return ok({
        id,
        canvas: canvas.value,
        clips: clips.value,
        elements: elements.value,
        captions: captions.value,
        licensedMusic: licensedMusic.value,
      });
    } finally {
      if (shouldClose) {
        await callMcp('closeProject', {}, signal).catch(() => undefined);
      }
    }
  };

  const stageReel = async (
    input: Record<string, unknown>,
    resolveMediaPath: ResolvePluginMediaPath | undefined,
    signal: AbortSignal,
  ): AsyncResult<unknown> => {
    // No verified remote API sets text duration. Reject it before touching the external project.
    if (
      Array.isArray(input['captions']) &&
      input['captions'].some(
        (item: unknown) => item !== null && typeof item === 'object' && 'duration' in item,
      )
    ) {
      return err(
        PluginInvalidInput(
          { pluginId: PLUGIN_ID },
          {
            detail: 'Explicit caption duration is unsupported; omit it to use the Edits default duration.',
          },
        ),
      );
    }
    const renderId = typeof input['renderId'] === 'string' ? input['renderId'].trim() : undefined;
    const assetId = typeof input['assetId'] === 'string' ? input['assetId'].trim() : undefined;
    const expectedSha256 =
      typeof input['expectedSha256'] === 'string' ? input['expectedSha256'].trim() : undefined;
    if (Boolean(renderId) === Boolean(assetId)) {
      return err(
        PluginInvalidInput(
          { pluginId: PLUGIN_ID },
          { detail: 'Provide exactly one of renderId or assetId.' },
        ),
      );
    }
    if (!resolveMediaPath) {
      return err(
        PluginInvalidInput(
          { pluginId: PLUGIN_ID },
          { detail: 'Media path resolver is required for staging.' },
        ),
      );
    }
    const resolved = await resolveMediaPath(
      {
        ...(renderId ? { renderId } : {}),
        ...(assetId ? { assetId } : {}),
        ...(expectedSha256 ? { expectedSha256 } : {}),
      },
      signal,
    );
    if (!resolved.ok) return resolved;
    const resolvedPath = resolved.value;

    const screen = await getScreen(signal);
    if (!screen.ok) return screen;
    if (screen.value === 'editor') {
      const closed = await callMcp('closeProject', {}, signal);
      if (!closed.ok) return closed;
    }
    const created = await callMcp('newProject', {}, signal);
    if (!created.ok) return created;

    const title = typeof input['title'] === 'string' ? input['title'].trim() : undefined;
    if (title) {
      const titled = await callMcp('setTitle', { title }, signal);
      if (!titled.ok) return titled;
    }

    const aspectRatio = typeof input['aspectRatio'] === 'string' ? input['aspectRatio'].trim() : undefined;
    const frameRate = typeof input['frameRate'] === 'number' ? input['frameRate'] : undefined;
    if (aspectRatio || frameRate !== undefined) {
      const canvas = await callMcp(
        'setCanvas',
        {
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(frameRate !== undefined ? { frameRate } : {}),
        },
        signal,
      );
      if (!canvas.ok) return canvas;
    }

    const addedMedia = await callMcp('addMedia', { path: resolvedPath, audioKind: 'main' }, signal);
    if (!addedMedia.ok) return addedMedia;

    if (typeof input['videoVolume'] === 'number') {
      const listedClips = await callMcp('clips', {}, signal);
      if (!listedClips.ok) return listedClips;
      const firstClipId = firstId(listedClips.value, 'clips') ?? firstId(addedMedia.value);
      if (firstClipId) {
        const volumeSet = await callMcp(
          'setVolume',
          { id: firstClipId, volume: input['videoVolume'] },
          signal,
        );
        if (!volumeSet.ok) return volumeSet;
      }
    }

    const audioAssetId = typeof input['audioAssetId'] === 'string' ? input['audioAssetId'].trim() : undefined;
    const audioTrackTitle =
      typeof input['audioTrackTitle'] === 'string' ? input['audioTrackTitle'].trim() : undefined;
    if (audioAssetId) {
      const addedSong = await callMcp(
        'addSongToComposition',
        { audioAssetId, track: audioTrackTitle || audioAssetId },
        signal,
      );
      if (!addedSong.ok) return addedSong;
      if (input['duckAudio'] === true) {
        let audioElementId = firstId(addedSong.value);
        if (!audioElementId) {
          const listedElements = await callMcp('elements', {}, signal);
          if (!listedElements.ok) return listedElements;
          audioElementId = firstId(listedElements.value, 'elements');
        }
        if (audioElementId) {
          const ducked = await callMcp('setDucking', { id: audioElementId, enabled: true }, signal);
          if (!ducked.ok) return ducked;
        }
      }
    }

    const captions = Array.isArray(input['captions'])
      ? (input['captions'] as Array<{
          text: string;
          startTime?: number;
          preset?: string;
          animation?: string;
        }>)
      : [];
    for (const item of captions) {
      if (typeof item.startTime === 'number') {
        const sought = await callMcp('seek', { seconds: item.startTime }, signal);
        if (!sought.ok) return sought;
      }
      const addedText = await callMcp('addText', { text: item.text }, signal);
      if (!addedText.ok) return addedText;
      const textId = firstId(addedText.value);
      if (textId && item.preset) {
        const presetRes = await callMcp('applyTextPreset', { id: textId, preset: item.preset }, signal);
        if (!presetRes.ok) return presetRes;
      }
      if (textId && item.animation) {
        const animRes = await callMcp('setTextAnimation', { id: textId, animation: item.animation }, signal);
        if (!animRes.ok) return animRes;
      }
    }

    if (input['generateAutoCaptions'] === true) {
      const generated = await callMcp('generateCaptions', {}, signal);
      if (!generated.ok) return generated;
    }

    const saved = await callMcp('saveProject', {}, signal);
    if (!saved.ok) return saved;

    return ok({
      staged: true,
      mediaPath: resolvedPath,
      title: title ?? null,
      audioAssetId: audioAssetId ?? null,
      captionsAdded: captions.length,
    });
  };

  return {
    tools: mcp.tools,
    callMcp,
    withEditorScreen,
    inspectProject,
    stageReel,
    close: () => mcp.close(),
  };
}
