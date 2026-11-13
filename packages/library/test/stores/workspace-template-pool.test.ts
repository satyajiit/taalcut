// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-TPL: the templates' pool. A template's composition files are kept apart from any project, so they outlive
 * the project they were designed in; a make copies them into its own. Prune keeps a pooled blob only while a
 * template version names it, and a project folder's prune never touches the pool.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { templateBlobPath, unwrap, type WorkspaceFile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTemplateStore } from '../../src/index';
import { tempDir } from '../helpers';
import { template } from './documents';
import { bytes, code, compositionOf, setup, withProject } from './workspace-setup';

const later = () => Date.now() + 2 * 60 * 60_000;

describe('the templates’ pool (HFW1-TPL)', () => {
  it('keeps a template’s files apart from any project, and a make copies them into its own', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const put = unwrap(await world.store.putTemplateBlob!(bytes('<div class="made-up"></div>')));
    expect(existsSync(join(world.dataRoot, templateBlobPath(put.sha256)))).toBe(true);
    expect(code(await world.store.readBlob(projectId, put.sha256))).toBe('core.not_found');
    const data = unwrap(await world.store.readTemplateBlob!(put.sha256));
    const copied = unwrap(await world.store.putBlob(projectId, data));
    expect(copied.sha256).toBe(put.sha256);
    expect(code(await world.store.readTemplateBlob!('ab'.repeat(32)))).toBe('core.not_found');
  });

  it('prunes a pooled blob no template version names, and keeps the ones they do', async () => {
    const world = await setup();
    const named = unwrap(await world.store.putTemplateBlob!(bytes('<p>kept</p>')));
    const loose = unwrap(await world.store.putTemplateBlob!(bytes('<p>loose</p>')));
    const templates = createTemplateStore(world.db, { assetsDir: join(tempDir(), 'assets') });
    const file: WorkspaceFile = { path: 'bubble/index.html', sha256: named.sha256, bytes: named.bytes };
    unwrap(
      await templates.create(
        {
          ...template({ sheet: null }),
          graphics: { uses: [], compositions: [compositionOf([file])] },
        },
        { name: 'Made-up reel', projectId: null, listed: true },
      ),
    );
    expect(unwrap(await world.store.prune({ now: later })).blobs).toBe(1);
    expect(code(await world.store.readTemplateBlob!(loose.sha256))).toBe('core.not_found');
    expect(code(await world.store.readTemplateBlob!(named.sha256))).toBe('ok');
  });
});
