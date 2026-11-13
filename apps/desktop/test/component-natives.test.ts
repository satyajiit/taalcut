// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * onnxruntime-node's binding comes from the onnxruntime component: only
 * onnxruntime-node's own request is redirected; without the component a
 * packaged app fails that load with a clear error and a checkout falls back
 * to node_modules. A real load under Electron's Node is in the packaged e2e.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installComponentNatives, redirectBinding } from '../src/utility/component-natives';

const ROOT = '/u/components';
const DIR = '/u/components/installed/onnxruntime/1.30.0-a2984fdecbe1';
const SPECIFIER = '../bin/napi-v6/darwin/arm64/onnxruntime_binding.node';
const PARENT = pathToFileURL(
  '/App.app/Contents/Resources/app.asar/node_modules/onnxruntime-node/dist/binding.js',
).href;
const installedAt = (dir: string | undefined) => (root: string, id: string) =>
  root === ROOT && id === 'onnxruntime' ? dir : undefined;

describe('redirectBinding', () => {
  it("points onnxruntime-node's binding at the installed component", () => {
    expect(
      redirectBinding(SPECIFIER, PARENT, { componentsRoot: ROOT, packaged: true }, installedAt(DIR)),
    ).toEqual({
      kind: 'component',
      component: 'onnxruntime',
      url: pathToFileURL(`${DIR}/bin/napi-v6/darwin/arm64/onnxruntime_binding.node`).href,
    });
  });

  it('takes the CUDA build where it is installed, then the CPU one (LNX1-CMP)', () => {
    const cuda = '/u/components/installed/onnxruntime-cuda/1.30.0-408673208f96';
    const both = (root: string, id: string) =>
      root === ROOT ? { 'onnxruntime-cuda': cuda, onnxruntime: DIR }[id] : undefined;
    const linux = '../bin/napi-v6/linux/x64/onnxruntime_binding.node';
    const parent = pathToFileURL(
      '/opt/Taalcut/resources/app.asar/node_modules/onnxruntime-node/dist/binding.js',
    );
    expect(redirectBinding(linux, parent.href, { componentsRoot: ROOT, packaged: true }, both)).toEqual({
      kind: 'component',
      component: 'onnxruntime-cuda',
      url: pathToFileURL(`${cuda}/bin/napi-v6/linux/x64/onnxruntime_binding.node`).href,
    });
    expect(
      redirectBinding(linux, parent.href, { componentsRoot: ROOT, packaged: true }, installedAt(DIR)),
    ).toMatchObject({ component: 'onnxruntime' });
  });

  it('leaves every other request alone', () => {
    const options = { componentsRoot: ROOT, packaged: true };
    expect(redirectBinding('onnxruntime-node', PARENT, options, installedAt(DIR)).kind).toBe('not-ours');
    expect(redirectBinding('./backend', PARENT, options, installedAt(DIR)).kind).toBe('not-ours');
    // The same file name asked for by some other package is not onnxruntime-node's.
    const other = pathToFileURL('/x/node_modules/evil/index.js').href;
    expect(redirectBinding(SPECIFIER, other, options, installedAt(DIR)).kind).toBe('not-ours');
    expect(redirectBinding(SPECIFIER, undefined, options, installedAt(DIR)).kind).toBe('not-ours');
  });

  it('without the component: a packaged app refuses, a checkout uses node_modules', () => {
    const packaged = redirectBinding(
      SPECIFIER,
      PARENT,
      { componentsRoot: ROOT, packaged: true },
      installedAt(undefined),
    );
    expect(packaged).toMatchObject({ kind: 'missing' });
    expect(packaged.kind === 'missing' && packaged.message).toMatch(/onnxruntime component is not installed/);
    expect(
      redirectBinding(SPECIFIER, PARENT, { componentsRoot: ROOT, packaged: false }, installedAt(undefined))
        .kind,
    ).toBe('default');
  });

  it('a checkout installing from a local release takes runtimes from components only, like a packaged app', () => {
    const managed = { componentsRoot: ROOT, packaged: false, managedOnly: true };
    expect(redirectBinding(SPECIFIER, PARENT, managed, installedAt(undefined)).kind).toBe('missing');
    expect(redirectBinding(SPECIFIER, PARENT, managed, installedAt(DIR))).toMatchObject({
      component: 'onnxruntime',
    });
  });
});

describe('installComponentNatives', () => {
  it('registers one resolve hook that defers to the next resolver for other modules', () => {
    const hooks: {
      resolve?: (s: string, c: { parentURL?: string }, n: (s: string) => unknown) => unknown;
    }[] = [];
    const register = ((h: (typeof hooks)[number]) => {
      hooks.push(h);
      return { deregister: () => undefined };
    }) as unknown as Parameters<typeof installComponentNatives>[1];
    expect(
      installComponentNatives({ componentsRoot: '/nowhere', packaged: true, log: () => undefined }, register),
    ).toBe(true);
    // Once per process.
    installComponentNatives({ componentsRoot: '/nowhere', packaged: true }, register);
    expect(hooks).toHaveLength(1);
    const next = (specifier: string) => ({ url: `next:${specifier}` });
    expect(hooks[0]!.resolve!('zod', { parentURL: PARENT }, next)).toEqual({ url: 'next:zod' });
    expect(() => hooks[0]!.resolve!(SPECIFIER, { parentURL: PARENT }, next)).toThrow(/not installed/);
  });

  it('a checkout’s node_modules fallback says so, once (UX3-IDX)', async () => {
    vi.resetModules();
    const fresh = await import('../src/utility/component-natives');
    const hooks: { resolve: (s: string, c: { parentURL?: string }, n: (s: string) => unknown) => unknown }[] =
      [];
    const register = ((h: (typeof hooks)[number]) => {
      hooks.push(h);
      return { deregister: () => undefined };
    }) as unknown as Parameters<typeof installComponentNatives>[1];
    const said: string[] = [];
    fresh.installComponentNatives(
      { componentsRoot: '/nowhere', packaged: false, log: (line) => said.push(line) },
      register,
    );
    const next = (specifier: string) => ({ url: `next:${specifier}` });
    expect(hooks[0]!.resolve(SPECIFIER, { parentURL: PARENT }, next)).toEqual({ url: `next:${SPECIFIER}` });
    hooks[0]!.resolve(SPECIFIER, { parentURL: PARENT }, next);
    expect(said).toEqual([
      '[components] onnxruntime binding from node_modules: no onnxruntime component in /nowhere ' +
        "(a development run's fallback; TAALCUT_DEV_COMPONENTS=<release> installs it)",
    ]);
  });
});
