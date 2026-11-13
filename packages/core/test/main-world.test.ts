// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The renderer side of the desktop app: getting the port to main through the
 * preload (connectToMain), and the theme engine's bridge over the theme
 * contract (themeBridgeOverRpc).
 */
import type { MessagePort } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  APP_CSP,
  APP_CSP_DIRECTIVES,
  connectRpc,
  connectToMain,
  isMainPortMessage,
  MAIN_PORT_MESSAGE,
  serveRpc,
  serializeCsp,
  themeBridgeOverRpc,
  themeContract,
  type MainWorldLike,
  type RpcBridge,
  type ThemePreference,
  type WindowMessageLike,
} from '@taalcut/core';
import { createFakeTheme, themeRouter } from './helpers/fixtures';
import { channel, tick } from './helpers/ports';

/** A window whose preload answers connect() by posting a port, the way apps/desktop's does. */
function fakeWindow(answer: (nonce: string, post: (event: WindowMessageLike) => void) => void) {
  const listeners = new Set<(event: WindowMessageLike) => void>();
  const post = (event: WindowMessageLike) => {
    for (const listener of [...listeners]) listener(event);
  };
  const bridge: RpcBridge = { connect: (nonce) => queueMicrotask(() => answer(nonce, post)) };
  const win: MainWorldLike & { listeners: number } = {
    taalcutRpc: bridge,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    get listeners() {
      return listeners.size;
    },
  };
  return win;
}

describe('connectToMain', () => {
  it('is null without a preload bridge (plain browser)', async () => {
    const win: MainWorldLike = { addEventListener: () => undefined, removeEventListener: () => undefined };
    expect(await connectToMain(win)).toEqual({ ok: true, value: null });
  });

  it('binds the port main sends for this nonce, ignoring anything else', async () => {
    const { port1, port2 } = channel();
    serveRpc({ theme: themeRouter(createFakeTheme('light')) }, port1, { context: {} });
    const decoy = channel();
    const win = fakeWindow((nonce, post) => {
      post({ data: { type: MAIN_PORT_MESSAGE, nonce: 'someone-else' }, source: win, ports: [decoy.port2] });
      post({ data: { type: MAIN_PORT_MESSAGE, nonce }, source: {}, ports: [decoy.port2] });
      post({ data: { type: MAIN_PORT_MESSAGE, nonce }, source: win, ports: [] });
      post({ data: 'hello', source: win, ports: [decoy.port2] });
      post({ data: { type: MAIN_PORT_MESSAGE, nonce }, source: win, ports: [port2] });
    });
    const connected = await connectToMain(win);
    if (!connected.ok || !connected.value) throw new Error('expected a connection');
    expect(await connected.value.client.theme.get()).toEqual({ preference: 'system', resolved: 'light' });
    expect(win.listeners).toBe(0);
    connected.value.close();
  });

  it('times out when main never answers', async () => {
    const win = fakeWindow(() => undefined);
    const result = await connectToMain(win, { timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, error: { code: 'core.timeout' } });
    expect(win.listeners).toBe(0);
  });

  it('recognises port messages', () => {
    expect(isMainPortMessage({ type: MAIN_PORT_MESSAGE, nonce: 'n' })).toBe(true);
    expect(isMainPortMessage({ type: MAIN_PORT_MESSAGE })).toBe(false);
    expect(isMainPortMessage(null)).toBe(false);
    expect(isMainPortMessage('taalcut:main-port')).toBe(false);
  });
});

function themeOverPort(port1: MessagePort, port2: MessagePort) {
  const theme = createFakeTheme('dark');
  serveRpc({ theme: themeRouter(theme) }, port1, { context: {} });
  const client = connectRpc({ theme: themeContract }, port2, { peer: 'main' }).client;
  return { theme, bridge: themeBridgeOverRpc(client.theme) };
}

describe('themeBridgeOverRpc', () => {
  it('gets and sets the preference, and reports changes made elsewhere', async () => {
    const { port1, port2 } = channel();
    const { theme, bridge } = themeOverPort(port1, port2);
    expect(await bridge.get()).toBe('system');
    const seen: ThemePreference[] = [];
    const stop = bridge.onChange((preference) => seen.push(preference));
    await tick(20);
    await bridge.set('light');
    theme.set('dark');
    await tick(20);
    expect(seen).toEqual(['system', 'light', 'dark']);
    stop();
    await tick(20);
    expect(theme.listenerCount).toBe(0);
  });

  it('rejects an unknown preference with a TaalcutError', async () => {
    const { port1, port2 } = channel();
    const { bridge } = themeOverPort(port1, port2);
    await expect(bridge.set('neon' as ThemePreference)).rejects.toMatchObject({ code: 'core.validation' });
    port2.close();
    await tick(10);
    await expect(bridge.get()).rejects.toMatchObject({ code: 'core.process_restarted' });
    // A stream that can't start ends quietly.
    expect(typeof bridge.onChange(() => undefined)).toBe('function');
  });
});

describe('app CSP', () => {
  it('serialises the directives into one header value', () => {
    expect(APP_CSP).toBe(serializeCsp(APP_CSP_DIRECTIVES));
    expect(APP_CSP).toContain("script-src 'self'; style-src 'self';");
    expect(serializeCsp({ 'a-src': ["'self'", 'b:'] })).toBe("a-src 'self' b:");
  });
});
