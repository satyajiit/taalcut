// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentTypeFor, planAppRequest } from '../src/main/protocol/resolve';
import { fileUnderRoot } from '../src/main/protocol/root-file';

const root = resolve('/app/out/renderer');
const files = new Set([
  join(root, 'index.html'),
  join(root, 'assets', 'index-abc.js'),
  join(root, 'assets', 'index-abc.css'),
  join(root, 'fonts', 'Inter Var.woff2'),
  join(root, '.env'),
]);
const isFile = (path: string) => files.has(path);
const get = (url: string, method = 'GET') => planAppRequest({ url, method }, root, isFile);

describe('planAppRequest', () => {
  it('serves files from the build with their content type', () => {
    expect(get('app://taalcut/assets/index-abc.js')).toEqual({
      kind: 'file',
      path: join(root, 'assets', 'index-abc.js'),
      contentType: 'text/javascript; charset=utf-8',
    });
    expect(get('app://taalcut/fonts/Inter%20Var.woff2')).toMatchObject({
      kind: 'file',
      contentType: 'font/woff2',
    });
  });

  it('serves index.html for / and for SPA routes', () => {
    const index = { kind: 'file', path: join(root, 'index.html'), contentType: 'text/html; charset=utf-8' };
    expect(get('app://taalcut/')).toEqual(index);
    expect(get('app://taalcut')).toEqual(index);
    expect(get('app://taalcut/projects/01JABC/edit')).toEqual(index);
    expect(get('app://taalcut/settings?tab=models#top')).toEqual(index);
  });

  it('returns 404 for a missing asset instead of HTML', () => {
    expect(get('app://taalcut/assets/missing.js')).toEqual({ kind: 'error', status: 404 });
  });

  it('blocks path traversal however it is spelled', () => {
    expect(get('app://taalcut/..%2f..%2fpackage.json')).toEqual({ kind: 'error', status: 400 });
    expect(get('app://taalcut/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd')).toEqual({
      kind: 'error',
      status: 400,
    });
    expect(get('app://taalcut/..%5c..%5cpackage.json')).toEqual({ kind: 'error', status: 400 });
    expect(get('app://taalcut/%2Fetc%2Fpasswd')).not.toMatchObject({ kind: 'file', path: '/etc/passwd' });
    // Literal ".." is folded by the URL parser first: this is the route /etc/passwd, inside the root.
    expect(get('app://taalcut/../../etc/passwd')).toMatchObject({
      kind: 'file',
      path: join(root, 'index.html'),
    });
    expect(get('app://taalcut/../../etc/hosts.txt')).toEqual({ kind: 'error', status: 404 });
  });

  it('refuses NUL bytes, malformed escapes and dot-files', () => {
    expect(get('app://taalcut/index.html%00.js')).toEqual({ kind: 'error', status: 400 });
    expect(get('app://taalcut/%E0%A4%A')).toEqual({ kind: 'error', status: 400 });
    expect(get('app://taalcut/.env')).toEqual({ kind: 'error', status: 404 });
  });

  it('answers only GET and HEAD on host taalcut', () => {
    expect(get('app://taalcut/', 'HEAD')).toMatchObject({ kind: 'file' });
    expect(get('app://taalcut/', 'POST')).toEqual({ kind: 'error', status: 405 });
    expect(get('app://other/')).toEqual({ kind: 'error', status: 404 });
    expect(get('https://taalcut/')).toEqual({ kind: 'error', status: 404 });
    expect(get('not a url')).toEqual({ kind: 'error', status: 400 });
  });

  it('returns 404 for routes when the build has no index.html', () => {
    expect(planAppRequest({ url: 'app://taalcut/', method: 'GET' }, root, () => false)).toEqual({
      kind: 'error',
      status: 404,
    });
  });
});

describe('fileUnderRoot (the real check, real symlinks)', () => {
  // base/secret.txt, base/outside/key.pem; base/build is the renderer root, reached through base/root-link.
  let base = '';
  let build = '';
  const serve = (url: string) =>
    planAppRequest({ url, method: 'GET' }, join(base, 'root-link'), fileUnderRoot(join(base, 'root-link')));

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-app-protocol-')));
    build = join(base, 'build');
    mkdirSync(join(build, 'assets'), { recursive: true });
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(build, 'index.html'), '<!doctype html>');
    writeFileSync(join(build, 'assets', 'app.js'), 'export {}');
    writeFileSync(join(base, 'secret.txt'), 'secret');
    writeFileSync(join(base, 'outside', 'key.pem'), 'key');
    symlinkSync(join(build, 'assets', 'app.js'), join(build, 'alias.js'));
    symlinkSync(join(base, 'secret.txt'), join(build, 'leak.txt'));
    symlinkSync('../secret.txt', join(build, 'assets', 'relative-leak.txt'));
    symlinkSync(join(base, 'secret.txt'), join(build, 'leak'));
    symlinkSync(join(base, 'outside'), join(build, 'linked-dir'));
    symlinkSync(build, join(base, 'root-link'));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('serves regular files, and links that stay inside the root', () => {
    expect(serve('app://taalcut/assets/app.js')).toMatchObject({ kind: 'file' });
    expect(serve('app://taalcut/alias.js')).toMatchObject({ kind: 'file' });
    expect(serve('app://taalcut/')).toMatchObject({
      kind: 'file',
      path: join(base, 'root-link', 'index.html'),
    });
  });

  it('refuses a symlink, or a linked directory, that points outside the root', () => {
    expect(serve('app://taalcut/leak.txt')).toEqual({ kind: 'error', status: 404 });
    expect(serve('app://taalcut/assets/relative-leak.txt')).toEqual({ kind: 'error', status: 404 });
    expect(serve('app://taalcut/linked-dir/key.pem')).toEqual({ kind: 'error', status: 404 });
    // No extension: an SPA route, so index.html, never the link's target.
    expect(serve('app://taalcut/leak')).toMatchObject({
      kind: 'file',
      path: join(base, 'root-link', 'index.html'),
    });
  });

  it('says no for directories, missing files and a missing root', () => {
    const isFile = fileUnderRoot(build);
    expect(isFile(join(build, 'assets'))).toBe(false);
    expect(isFile(join(build, 'missing.js'))).toBe(false);
    expect(isFile(join(build, 'leak.txt'))).toBe(false);
    expect(isFile(join(base, 'secret.txt'))).toBe(false);
    expect(fileUnderRoot(join(base, 'no-such-root'))(join(build, 'index.html'))).toBe(false);
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['a.html', 'text/html; charset=utf-8'],
    ['a.MJS', 'text/javascript; charset=utf-8'],
    ['a.svg', 'image/svg+xml'],
    ['a.wasm', 'application/wasm'],
    ['a.unknown', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s → %s', (file, type) => {
    expect(contentTypeFor(file)).toBe(type);
  });
});
