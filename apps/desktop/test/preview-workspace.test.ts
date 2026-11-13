// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: app://preview serves a project's workspace blobs, read-only, under the preview's CSP and typed by the
 * name a session links them as, and nothing else in the workspaces folder: no other file, no blob in the wrong
 * bucket or under a lower-case project id, no link on the way, no traversal out of it.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, PREVIEW_CSP } from '@taalcut/core';
import { servePreview } from '../src/main/render/preview-protocol';
import type { PreviewRoots } from '../src/main/render/preview-resolve';
import { isWorkspaceBlobPath } from '../src/main/render/preview-workspace';

const TOKEN = 'fedcba9876543210fedcba9876543210';
const CSS = '.card { color: #123456 }';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

let base: string;
let roots: PreviewRoots;
let workspaces: string;
const project = newId<'Project'>();
const blobOf = (projectId: string, hash: string, bucket = hash.slice(0, 2)) =>
  join(workspaces, projectId, 'blobs', bucket, hash);

const get = (path: string, method = 'GET', against: PreviewRoots = roots) =>
  servePreview(new Request(`app://preview/${TOKEN}/${path}`, { method }), against);

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'taalcut-preview-ws-'));
  const preview = join(base, 'cache', 'render', 'preview');
  const session = join(preview, TOKEN);
  workspaces = join(base, 'workspaces');
  const outside = join(base, 'outside');
  await mkdir(session, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret.css'), '.secret{}');

  const css = sha(CSS);
  await mkdir(join(workspaces, project, 'blobs', css.slice(0, 2)), { recursive: true });
  await writeFile(blobOf(project, css), CSS);
  await writeFile(join(workspaces, project, 'notes.txt'), 'not a blob');
  // In the wrong bucket, under a lower-case id, and links: to outside, to another blob, and a linked project.
  const other = sha('.other{}');
  await mkdir(join(workspaces, project, 'blobs', '00'), { recursive: true });
  await writeFile(blobOf(project, other, '00'), '.other{}');
  const linkedOut = sha('.linked-out{}');
  await mkdir(join(workspaces, project, 'blobs', linkedOut.slice(0, 2)), { recursive: true });
  await symlink(join(outside, 'secret.css'), blobOf(project, linkedOut));
  const linkedIn = sha('.linked-in{}');
  await mkdir(join(workspaces, project, 'blobs', linkedIn.slice(0, 2)), { recursive: true });
  await symlink(blobOf(project, css), blobOf(project, linkedIn));
  const linkedProject = newId<'Project'>();
  await symlink(join(workspaces, project), join(workspaces, linkedProject));

  await writeFile(
    join(session, 'manifest.json'),
    JSON.stringify({
      'ws/card/style.css': blobOf(project, css),
      'ws/card/index.html': blobOf(project, css),
      'ws/notes.txt': join(workspaces, project, 'notes.txt'),
      'ws/bucket.css': blobOf(project, other, '00'),
      'ws/lower.css': blobOf(project.toLowerCase(), css),
      'ws/out.css': blobOf(project, linkedOut),
      'ws/in.css': blobOf(project, linkedIn),
      'ws/project-link.css': blobOf(linkedProject, css),
      'ws/escape.css': `${join(workspaces, project, 'blobs', css.slice(0, 2))}/../../../../outside/secret.css`,
    }),
  );
  roots = { preview, allowed: [], workspaces };
});

afterAll(() => rm(base, { recursive: true, force: true }));

describe('app://preview: workspace blobs (HFW1-WS)', () => {
  it('serves a blob a session links, typed by its name, with the preview CSP', async () => {
    const response = await get('ws/card/style.css');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(PREVIEW_CSP);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe(CSS);
    expect((await get('ws/card/index.html')).headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('is read-only: only GET and HEAD', async () => {
    expect((await get('ws/card/style.css', 'HEAD')).status).toBe(200);
    for (const method of ['POST', 'PUT', 'DELETE'])
      expect((await get('ws/card/style.css', method)).status).toBe(405);
  });

  it('refuses anything else under the workspaces folder, links and traversal', async () => {
    for (const path of [
      'ws/notes.txt',
      'ws/bucket.css',
      'ws/lower.css',
      'ws/out.css',
      'ws/in.css',
      'ws/project-link.css',
      'ws/escape.css',
    ])
      expect((await get(path)).status, path).toBe(403);
  });

  it('serves no blob where main has no workspaces root', async () => {
    const without: PreviewRoots = { preview: roots.preview, allowed: [] };
    expect((await get('ws/card/style.css', 'GET', without)).status).toBe(403);
  });

  it('names a blob only by its full path in one project', () => {
    const hash = sha(CSS);
    expect(isWorkspaceBlobPath(workspaces, blobOf(project, hash))).toBe(true);
    expect(isWorkspaceBlobPath(workspaces, join(workspaces, project, 'blobs', hash.slice(0, 2)))).toBe(false);
    expect(isWorkspaceBlobPath(workspaces, workspaces)).toBe(false);
    expect(isWorkspaceBlobPath(workspaces, join(base, 'outside', 'secret.css'))).toBe(false);
    expect(isWorkspaceBlobPath(workspaces, blobOf(project, hash.toUpperCase(), hash.slice(0, 2)))).toBe(
      false,
    );
  });
});
