// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Where render's files live (main and the render process agree), and the fonts packaging ships. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderResources } from '../packaging/render-resources';
import { RENDER_FONTS_RESOURCE, renderFontsDir, renderPaths } from '../src/shared/render-paths';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('renderPaths', () => {
  it('keeps the cache and the renders folder under userData', () => {
    expect(renderPaths('/u')).toEqual({
      cache: join('/u', 'cache', 'render'),
      preview: join('/u', 'cache', 'render', 'preview'),
      work: join('/u', 'cache', 'render', 'work'),
      conform: join('/u', 'cache', 'render', 'conform'),
      renders: join('/u', 'renders'),
    });
  });

  it('finds the fonts in Resources when packaged and in packages/render in a checkout', () => {
    expect(renderFontsDir({ packaged: true, resourcesPath: '/App/Resources', desktopDir: '/x' })).toBe(
      join('/App/Resources', 'render', 'fonts'),
    );
    expect(renderFontsDir({ packaged: false, resourcesPath: '/r', desktopDir: '/repo/apps/desktop' })).toBe(
      join('/repo', 'packages', 'render', 'fonts'),
    );
  });
});

describe('renderResources', () => {
  it('ships packages/render/fonts at Resources/render/fonts, without dot-files', () => {
    const repo = mkdtempSync(join(tmpdir(), 'taalcut-pack-'));
    dirs.push(repo);
    const project = join(repo, 'apps', 'desktop');
    mkdirSync(project, { recursive: true });
    expect(renderResources(project)).toEqual([]);
    mkdirSync(join(repo, 'packages', 'render', 'fonts'), { recursive: true });
    expect(renderResources(project)).toEqual([
      {
        from: join(project, '..', '..', 'packages', 'render', 'fonts'),
        to: RENDER_FONTS_RESOURCE,
        filter: ['**/*', '!**/.*'],
      },
    ]);
  });
});
