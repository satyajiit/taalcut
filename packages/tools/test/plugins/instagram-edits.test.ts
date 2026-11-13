// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { err, ok } from '@taalcut/core';
import {
  connectInstagramEditsMcp,
  createInstagramEditsPluginDefinition,
  INSTAGRAM_EDITS_DEFAULT_URL,
  INSTAGRAM_EDITS_TOOLS,
  instagramEditsConfigSchema,
  instagramEditsManifest,
  instagramEditsSkills,
  PluginInvalidInput,
  type PluginContext,
  type PluginMcpSession,
} from '@taalcut/tools';

const closing: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function createContext(token: string | undefined = 'edits-secret-token'): PluginContext {
  const noop = async () => ok(undefined);
  return {
    config: { 'mcp-url': INSTAGRAM_EDITS_DEFAULT_URL },
    secrets: {
      async get(id) {
        return ok(id === 'access-token' ? token : undefined);
      },
    },
    data: { get: noop, set: noop, delete: noop, clear: noop },
  };
}

describe('Instagram Edits plugin (EDITS-1..3)', () => {
  it('validates loopback, LAN, and HTTPS MCP URLs while rejecting public HTTP or credentials', () => {
    const validDefault = instagramEditsConfigSchema.safeParse({});
    expect(validDefault.success).toBe(true);
    if (validDefault.success) expect(validDefault.data['mcp-url']).toBe(INSTAGRAM_EDITS_DEFAULT_URL);

    const trailingSlash = instagramEditsConfigSchema.safeParse({
      'mcp-url': 'http://192.168.1.42:19501/mcp///',
    });
    expect(trailingSlash.success).toBe(true);
    if (trailingSlash.success) {
      expect(trailingSlash.data['mcp-url']).toBe('http://192.168.1.42:19501/mcp');
    }

    expect(instagramEditsConfigSchema.safeParse({ 'mcp-url': 'http://example.com:19501/mcp' }).success).toBe(
      false,
    );
    expect(
      instagramEditsConfigSchema.safeParse({ 'mcp-url': 'http://user:pass@127.0.0.1:19501/mcp' }).success,
    ).toBe(false);
    expect(
      instagramEditsConfigSchema.safeParse({ 'mcp-url': 'http://127.0.0.1:19501/mcp?token=1' }).success,
    ).toBe(false);
    expect(instagramEditsManifest.skills.map((s) => s.id)).toEqual(instagramEditsSkills.map((s) => s.id));
    expect(INSTAGRAM_EDITS_TOOLS).toHaveLength(16);
  });

  it('switches home -> newProject -> editor -> closeProject for music tools and preserves open editor projects', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    let currentScreen: 'home' | 'editor' = 'home';

    const fakeSession: PluginMcpSession = {
      tools: [
        {
          name: 'customServerTool',
          description: 'Dynamic tool from Edits',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
      async call(name, input) {
        calls.push({ name, input });
        if (name === 'appState') return ok({ screen: currentScreen });
        if (name === 'newProject') {
          currentScreen = 'editor';
          return ok({ id: 'ephemeral-proj' });
        }
        if (name === 'closeProject') {
          currentScreen = 'home';
          return ok({ closed: true });
        }
        if (name === 'browseMusicCategories') {
          return ok({ categories: ['For You', 'Trending', 'Original audio', 'Royalty-free'] });
        }
        if (name === 'listMusicTracks') {
          return ok({
            tracks: [{ audioAssetId: 'ig-audio-99', title: 'Neon Monsoon', highlights: [4.2, 12.5] }],
          });
        }
        if (name === 'getSavedTracks') return ok({ tracks: [{ audioAssetId: 'ig-saved-1' }] });
        if (name === 'getMusicTrackDetails') return ok({ audioAssetId: input['track'] });
        if (name === 'favoriteMusicTrack') return ok({ bookmarked: true, track: input['track'] });
        if (name === 'searchSoundEffects') return ok({ effects: [{ id: 'sfx-whoosh' }] });
        return ok({ ok: true });
      },
      async close() {},
    };

    const def = createInstagramEditsPluginDefinition({ connectMcp: async () => ok(fakeSession) });
    const adapter = def.create(createContext());
    const signal = new AbortController().signal;

    const connected = await adapter.connect(signal);
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.value.some((t) => t.name === 'mcp.customServerTool')).toBe(true);

    const categories = await adapter.invoke('api.browseMusicCategories', {}, signal);
    expect(categories.ok).toBe(true);
    expect(currentScreen).toBe('home');
    expect(calls.map((c) => c.name)).toEqual([
      'appState',
      'newProject',
      'browseMusicCategories',
      'closeProject',
    ]);

    calls.length = 0;
    currentScreen = 'editor';
    const tracks = await adapter.invoke(
      'api.listMusicTracks',
      { tab: 'Trending', query: 'monsoon', license: 'licensed' },
      signal,
    );
    expect(tracks.ok).toBe(true);
    expect(calls.map((c) => c.name)).toEqual(['appState', 'listMusicTracks']);
    expect(calls[1]?.input).toEqual({ tab: 'Trending', query: 'monsoon', license: 'licensed' });

    expect((await adapter.invoke('api.getSavedTracks', {}, signal)).ok).toBe(true);
    expect((await adapter.invoke('api.getMusicTrackDetails', { track: 'ig-audio-99' }, signal)).ok).toBe(
      true,
    );
    expect((await adapter.invoke('api.favoriteMusicTrack', { track: 'ig-audio-99' }, signal)).ok).toBe(true);
    expect((await adapter.invoke('api.searchSoundEffects', { query: 'whoosh' }, signal)).ok).toBe(true);
    await adapter.dispose();
  });

  it('inspects cloud projects, exports/imports .mcomp, and stages Reels with audio and captions', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    let screen: 'home' | 'editor' = 'home';

    const fakeSession: PluginMcpSession = {
      tools: [],
      async call(name, input) {
        calls.push({ name, input });
        if (name === 'appState') return ok({ screen });
        if (name === 'openProject' || name === 'newProject') {
          screen = 'editor';
          return ok({ id: input['id'] ?? 'staged-proj-1' });
        }
        if (name === 'closeProject') {
          screen = 'home';
          return ok({ closed: true });
        }
        if (name === 'listProjects') return ok({ projects: [{ id: 'cloud-1', name: 'Draft Reel' }] });
        if (name === 'getCanvas') return ok({ aspectRatio: '9:16', frameRate: 30 });
        if (name === 'clips') return ok({ clips: [{ id: 'clip-main-1', duration: 12.4 }] });
        if (name === 'elements') return ok({ elements: [{ id: 'el-audio-1', type: 'audio' }] });
        if (name === 'getCaptions') return ok({ captions: [{ text: 'Hook line', start: 0 }] });
        if (name === 'hasLicensedMusic') return ok({ licensed: true });
        if (name === 'addMedia') return ok({ id: 'clip-main-1' });
        if (name === 'addSongToComposition') return ok({ id: 'song-el-1' });
        if (name === 'addText') return ok({ id: `text-${calls.length}` });
        return ok({ ok: true });
      },
      async close() {},
    };

    const def = createInstagramEditsPluginDefinition({
      connectMcp: async () => ok(fakeSession),
      resolveMediaPath: async (upload) =>
        upload.renderId === 'render-123'
          ? ok('/tmp/taalcut-verified-render-123.mp4')
          : err(PluginInvalidInput({ pluginId: 'instagram-edits' })),
    });
    const adapter = def.create(createContext());
    const signal = new AbortController().signal;
    await adapter.connect(signal);

    expect((await adapter.invoke('api.listProjects', {}, signal)).ok).toBe(true);
    const inspected = await adapter.invoke('api.inspectProject', { id: 'cloud-1' }, signal);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(inspected.value).toMatchObject({
        id: 'cloud-1',
        canvas: { aspectRatio: '9:16', frameRate: 30 },
        licensedMusic: { licensed: true },
      });
    }
    expect(screen).toBe('home');
    expect((await adapter.invoke('api.stageReel', { title: 'Invalid' }, signal)).ok).toBe(false);

    calls.length = 0;
    screen = 'editor';
    const staged = await adapter.invoke(
      'api.stageReel',
      {
        renderId: 'render-123',
        title: 'Launch Reel',
        aspectRatio: '9:16',
        frameRate: 60,
        videoVolume: 0.85,
        audioAssetId: 'ig-trending-777',
        audioTrackTitle: 'Monsoon Drop',
        duckAudio: true,
        captions: [
          { text: 'Wait for the drop', startTime: 0.5, preset: 'Meme', animation: 'Pop' },
        ],
        generateAutoCaptions: true,
      },
      signal,
    );
    expect(staged).toEqual(
      ok({
        staged: true,
        mediaPath: '/tmp/taalcut-verified-render-123.mp4',
        title: 'Launch Reel',
        audioAssetId: 'ig-trending-777',
        captionsAdded: 1,
      }),
    );
    expect(calls.map((c) => c.name)).toEqual([
      'appState',
      'closeProject',
      'newProject',
      'setTitle',
      'setCanvas',
      'addMedia',
      'clips',
      'setVolume',
      'addSongToComposition',
      'setDucking',
      'seek',
      'addText',
      'applyTextPreset',
      'setTextAnimation',
      'generateCaptions',
      'saveProject',
    ]);

    expect((await adapter.invoke('api.exportMcomp', { id: 'cloud-1', returnBytes: true }, signal)).ok).toBe(
      true,
    );
    expect((await adapter.invoke('api.importMcomp', { path: '/tmp/project.mcomp' }, signal)).ok).toBe(true);
  });

  it('invokes MetaAISceneX, SAM 3 object cutout tracking, and audio DSP co-processor tools', async () => {
    const fakeSession: PluginMcpSession = {
      tools: [],
      async call(name, input) {
        if (name === 'describeClip') return ok({ aestheticScore: 0.91, vibes: ['energetic'] });
        if (name === 'trackObject') return ok({ trackedFrames: 48, maskId: 'mask-1' });
        if (name === 'addStickerFromCutout') return ok({ stickerId: 'sticker-cutout-1' });
        if (name === 'audioOnsets') return ok({ onsets: [0.25, 0.75, 1.25], bpm: 120 });
        if (name === 'loudness') return ok({ integratedLufs: -14.2 });
        if (name === 'audioChords') return ok({ chords: ['Cmaj', 'Gmaj'] });
        if (name === 'findPauses') return ok({ pauses: [{ start: 2.1, end: 2.6 }] });
        if (name === 'quietPoint') return ok({ quietPointSeconds: 2.35 });
        if (name === 'processAudio') return ok({ voiceEnhanced: true });
        if (name === 'setSound') return ok({ volumeDb: input['volumeDb'] });
        return ok({});
      },
      async close() {},
    };

    const def = createInstagramEditsPluginDefinition({ connectMcp: async () => ok(fakeSession) });
    const adapter = def.create(createContext());
    const signal = new AbortController().signal;
    await adapter.connect(signal);

    expect((await adapter.invoke('api.describeClip', { id: 'clip-1', frames: 8 }, signal)).ok).toBe(true);
    const tracked = await adapter.invoke(
      'api.trackObject',
      { id: 'clip-1', prompt: 'coffee mug', sampleEvery: 2, saveMasks: true, createCutoutSticker: true },
      signal,
    );
    expect(tracked).toEqual(
      ok({
        trackedFrames: 48,
        maskId: 'mask-1',
        cutoutSticker: { stickerId: 'sticker-cutout-1' },
      }),
    );

    const analyzed = await adapter.invoke(
      'api.analyzeAudio',
      { id: 'clip-1', includeChords: true, includePauses: true },
      signal,
    );
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) {
      expect(analyzed.value).toMatchObject({
        id: 'clip-1',
        onsets: { onsets: [0.25, 0.75, 1.25], bpm: 120 },
        loudness: { integratedLufs: -14.2 },
        chords: { chords: ['Cmaj', 'Gmaj'] },
        pauses: { pauses: [{ start: 2.1, end: 2.6 }] },
        quietPoint: { quietPointSeconds: 2.35 },
      });
    }

    const enhanced = await adapter.invoke(
      'api.enhanceAudio',
      { id: 'clip-1', reduceNoise: 0.7, enhanceVoice: 0.9, volumeDb: -1.5 },
      signal,
    );
    expect(enhanced).toEqual(
      ok({ id: 'clip-1', audio: { voiceEnhanced: true }, sound: { volumeDb: -1.5 } }),
    );
  });

  it('connects over Streamable HTTP MCP, unwraps JSON text payloads, and reports 401 auth errors', async () => {
    let rejectAuth = false;
    const handle = async (req: IncomingMessage, res: ServerResponse) => {
      if (rejectAuth || req.headers.authorization !== 'Bearer live-token') {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(chunks).toString()) as {
        id?: number;
        method: string;
        params?: { name?: string };
      };
      if (rpc.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      const result =
        rpc.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              serverInfo: { name: 'metapilot-native', version: '1.0.0' },
              capabilities: { tools: {} },
            }
          : rpc.method === 'tools/list'
            ? { tools: [{ name: 'appState', inputSchema: { type: 'object', properties: {} } }] }
            : {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ screen: 'editor', calledTool: rpc.params?.name }),
                  },
                ],
              };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    };

    const server = createServer((req, res) => {
      void handle(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closing.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Expected TCP port');
    const url = `http://127.0.0.1:${addr.port}/mcp`;

    const connected = await connectInstagramEditsMcp({
      url,
      token: 'live-token',
      fetch,
      signal: AbortSignal.timeout(3_000),
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    closing.push(connected.value.close);

    const editorCall = await connected.value.call('browseMusicCategories', {}, AbortSignal.timeout(3_000));
    expect(editorCall).toEqual(ok({ screen: 'editor', calledTool: 'browseMusicCategories' }));

    rejectAuth = true;
    const unauth = await connectInstagramEditsMcp({
      url,
      token: 'wrong-token',
      fetch,
      signal: AbortSignal.timeout(3_000),
    });
    expect(unauth.ok).toBe(false);
    if (!unauth.ok) expect(unauth.error.code).toBe('tools.plugin_authentication_failed');
  });
});
