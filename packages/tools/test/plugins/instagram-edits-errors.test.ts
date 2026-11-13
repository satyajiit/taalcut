// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { err, ok, unwrap, type AsyncResult } from '@taalcut/core';
import {
  createInstagramEditsPluginDefinition,
  instagramEditsConfigSchema,
  PluginAuthenticationFailed,
  PluginRemoteFailed,
  type PluginContext,
  type PluginMcpSession,
} from '@taalcut/tools';

const signal = new AbortController().signal;
const remoteError = PluginRemoteFailed({ pluginId: 'instagram-edits' });
type Reply = (name: string, input: Record<string, unknown>) => AsyncResult<unknown>;

async function world(options: { fail?: string; screen?: unknown; reply?: Reply; resolver?: boolean } = {}) {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const close = vi.fn(async () => undefined);
  const remote: PluginMcpSession = {
    tools: [{ name: 'raw', inputSchema: {} }],
    close,
    async call(name, input) {
      calls.push({ name, input });
      if (name === options.fail) return err(remoteError);
      if (name === 'appState') return ok({ screen: options.screen ?? 'home' });
      if (options.reply) return options.reply(name, input);
      return ok({ id: `${name}-id` });
    },
  };
  const noop = async () => ok(undefined);
  const context: PluginContext = {
    config: { 'mcp-url': 'http://localhost:19501/mcp' },
    secrets: { get: async () => ok('token') },
    data: { get: noop, set: noop, delete: noop, clear: noop },
  };
  const resolveMediaPath = vi.fn(async () => ok('/verified/render.mp4'));
  const definition = createInstagramEditsPluginDefinition({
    connectMcp: async () => ok(remote),
    ...(options.resolver === false ? {} : { resolveMediaPath }),
  });
  const adapter = definition.create(context);
  unwrap(await adapter.connect(signal));
  return { adapter, calls, close, context, definition, resolveMediaPath };
}

describe('Instagram Edits failure isolation and session lifetime', () => {
  it('requires authentication before connecting or invoking and drops a disposed session', async () => {
    const w = await world();
    await w.adapter.dispose();
    await w.adapter.dispose();
    expect(w.close).toHaveBeenCalledTimes(1);
    expect(await w.adapter.invoke('api.appState', {}, signal)).toMatchObject({
      ok: false,
      error: { code: 'tools.plugin_authentication_failed' },
    });
    for (const secret of [ok(undefined), err(PluginAuthenticationFailed({ pluginId: 'instagram-edits' }))]) {
      const adapter = w.definition.create({ ...w.context, secrets: { get: async () => secret } });
      expect(await adapter.connect(signal)).toMatchObject({ ok: false });
    }
    expect(w.calls).toEqual([]);
  });

  it('propagates connector failures without making a session available', async () => {
    const w = await world();
    const adapter = createInstagramEditsPluginDefinition({ connectMcp: async () => err(remoteError) }).create(
      w.context,
    );
    expect(await adapter.connect(signal)).toEqual(err(remoteError));
    expect(await adapter.invoke('mcp.raw', {}, signal)).toMatchObject({ ok: false });
    await adapter.dispose();
  });

  it.each([
    ['api.describeClip', {}],
    ['api.trackObject', { id: 'clip', prompt: '  ' }],
    ['api.analyzeAudio', { id: 2 }],
    ['api.enhanceAudio', { id: '  ' }],
    ['api.inspectProject', { id: 2 }],
    ['api.getMusicTrackDetails', { track: ' ' }],
    ['api.getMusicTrackDetails', { track: 'track-id', preview: true }],
    ['api.getMusicTrackDetails', { track: 'track-id', preview: false }],
    ['api.favoriteMusicTrack', {}],
    ['api.exportMcomp', {}],
    ['api.importMcomp', {}],
  ] as const)('rejects invalid %s input before touching the remote app', async (name, input) => {
    const w = await world();
    expect(await w.adapter.invoke(name, input, signal)).toMatchObject({
      ok: false,
      error: { code: 'tools.plugin_invalid_input' },
    });
    expect(w.calls).toEqual([]);
  });

  it.each([
    { screen: 'home', fails: false },
    { screen: 'home', fails: true },
    { screen: 'editor', fails: false },
    { screen: 'editor', fails: true },
  ])(
    'keeps music details metadata-only and restores $screen when fails=$fails',
    async ({ screen, fails }) => {
      const w = await world({ screen, ...(fails ? { fail: 'getMusicTrackDetails' } : {}) });
      const result = await w.adapter.invoke('api.getMusicTrackDetails', { track: 'track-id' }, signal);
      expect(result.ok).toBe(!fails);
      expect(w.calls.map((call) => call.name)).toEqual(
        screen === 'home'
          ? ['appState', 'newProject', 'getMusicTrackDetails', 'closeProject']
          : ['appState', 'getMusicTrackDetails'],
      );
      await w.adapter.dispose();
    },
  );

  it('refuses unknown tools and maps thrown remote errors without exposing their text', async () => {
    const w = await world({
      reply: async () => {
        throw new Error('private remote credential');
      },
    });
    expect(await w.adapter.invoke('api.unknown', {}, signal)).toMatchObject({
      ok: false,
      error: { code: 'tools.plugin_invalid_tool' },
    });
    const result = await w.adapter.invoke('mcp.raw', {}, signal);
    expect(result).toMatchObject({ ok: false, error: { code: 'tools.plugin_connection_failed' } });
    expect(JSON.stringify(result)).not.toContain('private remote credential');
  });

  it.each(['appState', 'newProject', 'browseMusicCategories'])(
    'does not mask a music failure at %s',
    async (fail) => {
      const w = await world({ fail });
      expect(await w.adapter.invoke('api.browseMusicCategories', {}, signal)).toEqual(err(remoteError));
      expect(w.calls.some((call) => call.name === 'closeProject')).toBe(fail === 'browseMusicCategories');
    },
  );

  it.each([
    'closeProject',
    'openProject',
    'getCanvas',
    'clips',
    'elements',
    'getCaptions',
    'hasLicensedMusic',
  ])('propagates inspection failure at %s and closes temporary projects', async (fail) => {
    const w = await world({ fail, screen: fail === 'closeProject' ? 'editor' : 'home' });
    expect(await w.adapter.invoke('api.inspectProject', { id: 'project' }, signal)).toEqual(err(remoteError));
    if (!['closeProject', 'openProject'].includes(fail)) expect(w.calls.at(-1)?.name).toBe('closeProject');
  });

  it('can keep an inspected project open by explicit request and accepts unknown app screens', async () => {
    const w = await world({ screen: 7 });
    expect(
      (await w.adapter.invoke('api.inspectProject', { id: ' p ', name: ' Name ', closeAfter: false }, signal))
        .ok,
    ).toBe(true);
    expect(w.calls.find((call) => call.name === 'openProject')?.input).toEqual({ id: 'p', name: 'Name' });
    expect(w.calls.some((call) => call.name === 'closeProject')).toBe(false);
  });
});

describe('Instagram Edits coprocessor and archive contracts', () => {
  it.each(['audioOnsets', 'loudness', 'audioChords', 'findPauses', 'quietPoint'])(
    'propagates %s analysis failure instead of returning a partial successful report',
    async (fail) => {
      const w = await world({ fail });
      expect(
        await w.adapter.invoke(
          'api.analyzeAudio',
          { id: 'clip', path: '/clip', start: 1, duration: 2 },
          signal,
        ),
      ).toEqual(err(remoteError));
      expect(w.calls.at(-1)?.name).toBe(fail);
    },
  );

  it('honours disabled audio analyses and omits absent numeric options', async () => {
    const w = await world();
    const report = unwrap(
      await w.adapter.invoke(
        'api.analyzeAudio',
        { id: ' clip ', includeChords: false, includePauses: false },
        signal,
      ),
    );
    expect(report).toEqual({ id: 'clip', onsets: { id: 'audioOnsets-id' }, loudness: { id: 'loudness-id' } });
    expect(w.calls.map((call) => call.name)).toEqual(['audioOnsets', 'loudness']);
    expect(w.calls.every((call) => Object.keys(call.input).length === 1)).toBe(true);
  });

  it.each(['trackObject', 'addStickerFromCutout', 'processAudio', 'setSound'])(
    'does not report success or continue after %s fails',
    async (fail) => {
      const w = await world({ fail });
      const tracking = fail === 'trackObject' || fail === 'addStickerFromCutout';
      const result = await w.adapter.invoke(
        tracking ? 'api.trackObject' : 'api.enhanceAudio',
        {
          id: 'clip',
          prompt: 'person',
          createCutoutSticker: true,
          volumeDb: -3,
        },
        signal,
      );
      expect(result).toEqual(err(remoteError));
      expect(w.calls.at(-1)?.name).toBe(fail);
    },
  );

  it('supports raw tracking responses and keeps optional enhancement side effects opt-in', async () => {
    const w = await world({ reply: async () => ok(42) });
    expect(
      unwrap(
        await w.adapter.invoke(
          'api.trackObject',
          { id: 'clip', prompt: ' person ', createCutoutSticker: true },
          signal,
        ),
      ),
    ).toEqual({ tracking: 42, cutoutSticker: 42 });
    w.calls.length = 0;
    expect(unwrap(await w.adapter.invoke('api.enhanceAudio', { id: 'clip' }, signal))).toBe(42);
    expect(w.calls).toEqual([{ name: 'processAudio', input: { id: 'clip' } }]);
    await w.adapter.invoke('api.describeClip', { id: 'clip' }, signal);
    expect(w.calls.at(-1)).toEqual({ name: 'describeClip', input: { id: 'clip' } });
  });

  it('preserves non-JSON MCP responses while decoding JSON text envelopes', async () => {
    const responses = [
      null,
      42,
      { content: [] },
      { content: [{ type: 'image' }] },
      { content: [{ type: 'text', text: '  ' }] },
      { content: [{ type: 'text', text: ' plain ' }] },
      { content: [{ type: 'text', text: '{"saved":true}' }] },
    ];
    const w = await world({ reply: async () => ok(responses.shift()) });
    const expected = [
      null,
      42,
      { content: [] },
      { content: [{ type: 'image' }] },
      '',
      ' plain ',
      { saved: true },
    ];
    for (const value of expected)
      expect(unwrap(await w.adapter.invoke('mcp.raw', {}, signal))).toEqual(value);
  });

  it('forwards trimmed archive selectors, explicit false flags, and optional music search filters', async () => {
    const w = await world({ screen: 'editor' });
    await w.adapter.invoke('api.exportMcomp', { id: ' p ', path: ' /out ', returnBytes: false }, signal);
    await w.adapter.invoke('api.importMcomp', { archiveBase64: ' YQ== ' }, signal);
    await w.adapter.invoke('api.listMusicTracks', {}, signal);
    await w.adapter.invoke('api.searchSoundEffects', {}, signal);
    expect(w.calls).toContainEqual({
      name: 'exportMcomp',
      input: { id: 'p', path: '/out', returnBytes: false },
    });
    expect(w.calls).toContainEqual({ name: 'importMcomp', input: { archiveBase64: 'YQ==' } });
    expect(w.calls).toContainEqual({ name: 'listMusicTracks', input: {} });
    expect(w.calls).toContainEqual({ name: 'searchSoundEffects', input: {} });
  });
});

describe('Instagram Edits staging rejects incomplete handoffs', () => {
  it.each([{}, { renderId: 'render', assetId: 'asset' }, { renderId: ' ' }])(
    'requires exactly one media selector',
    async (input) => {
      const w = await world();
      expect(await w.adapter.invoke('api.stageReel', input, signal)).toMatchObject({ ok: false });
      expect(w.resolveMediaPath).not.toHaveBeenCalled();
      expect(w.calls).toEqual([]);
    },
  );

  it('rejects staging without an authorized media resolver', async () => {
    const w = await world({ resolver: false });
    expect(await w.adapter.invoke('api.stageReel', { assetId: 'asset' }, signal)).toMatchObject({
      ok: false,
    });
    expect(w.calls).toEqual([]);
  });

  it.each([
    'appState',
    'closeProject',
    'newProject',
    'setTitle',
    'setCanvas',
    'addMedia',
    'clips',
    'setVolume',
    'addSongToComposition',
    'elements',
    'setDucking',
    'seek',
    'addText',
    'applyTextPreset',
    'setTextAnimation',
    'generateCaptions',
    'saveProject',
  ])('returns the failure at %s without saving an incomplete reel', async (fail) => {
    const w = await world({
      fail,
      screen: 'editor',
      reply: async (name) => ok(name === 'addSongToComposition' ? {} : { id: `${name}-id` }),
    });
    const result = await w.adapter.invoke(
      'api.stageReel',
      {
        assetId: 'asset',
        title: 'Trip',
        aspectRatio: '9:16',
        frameRate: 30,
        videoVolume: 0.5,
        audioAssetId: 'song',
        duckAudio: true,
        generateAutoCaptions: true,
        captions: [{ text: 'Hello', startTime: 1, preset: 'bold', animation: 'pop' }],
      },
      signal,
    );
    expect(result).toEqual(err(remoteError));
    expect(w.calls.at(-1)?.name).toBe(fail);
    if (fail !== 'saveProject') expect(w.calls.some((call) => call.name === 'saveProject')).toBe(false);
  });

  it('stages a minimal verified asset without optional editor mutations', async () => {
    const w = await world();
    expect(
      unwrap(
        await w.adapter.invoke('api.stageReel', { assetId: ' asset ', expectedSha256: ' abc ' }, signal),
      ),
    ).toMatchObject({ staged: true, title: null, audioAssetId: null, captionsAdded: 0 });
    expect(w.resolveMediaPath).toHaveBeenCalledWith({ assetId: 'asset', expectedSha256: 'abc' }, signal);
    expect(w.calls.map((call) => call.name)).toEqual(['appState', 'newProject', 'addMedia', 'saveProject']);
  });
});

describe('Instagram Edits endpoint trust boundary', () => {
  it.each([
    'http://10.1.2.3',
    'http://172.16.0.1',
    'http://100.64.0.1',
    'http://box.local',
    'http://box.ts.net',
    'http://box.localhost',
    'http://127.1.1.1',
  ])('accepts local endpoint %s', (url) => {
    expect(instagramEditsConfigSchema.safeParse({ 'mcp-url': url }).success).toBe(true);
  });
  it.each([
    'not a URL',
    'file:///tmp/mcp',
    'http://172.15.0.1/mcp',
    'http://172.32.0.1/mcp',
    'http://100.128.0.1/mcp',
    'http://192.167.0.1/mcp',
    'https://example.com/mcp#token',
  ])('refuses unsafe endpoint %s', (url) => {
    expect(instagramEditsConfigSchema.safeParse({ 'mcp-url': url }).success).toBe(false);
  });
});
