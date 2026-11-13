// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tests for workspace management tools (`workspace.delete`, `workspace.move`, `workspace.search`),
 * `_taalcut/brief.md` persistence via `writeReserved`, and the `taalcut/sandbox-workspace` docs topic.
 */
import { describe, expect, it } from 'vitest';
import { WORKSPACE_EXTRA_TOOLS, WORKSPACE_TOOLS } from '../src';
import { spokenTimeline } from './compositions/support';
import { workspaceWorld } from './workspace/tools/support';

const value = <T>(result: { ok: boolean; value?: unknown; error?: unknown }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value as T;
};

describe('workspace management tools & brief persistence', () => {
  it('keeps WORKSPACE_TOOLS as the original 12 tools and exports WORKSPACE_EXTRA_TOOLS separately', () => {
    expect(WORKSPACE_TOOLS).toHaveLength(12);
    expect(WORKSPACE_EXTRA_TOOLS).toEqual(['workspace.delete', 'workspace.move', 'workspace.search']);
    for (const extra of WORKSPACE_EXTRA_TOOLS) {
      expect(WORKSPACE_TOOLS).not.toContain(extra);
    }
  });

  it('persists _taalcut/brief.md via writeReserved on workspace.read and workspace.list with timelineId', async () => {
    const timeline = spokenTimeline([[10, 60, 'welcome to the mountain trail']]);
    const world = workspaceWorld(timeline);
    const { projectId } = world;

    // Before reading or listing with timelineId, reading _taalcut/brief.md without timelineId fails with a clear hint.
    const before = await world.call('workspace.read', { projectId, path: '_taalcut/brief.md' });
    expect(before.ok).toBe(false);
    if (!before.ok) {
      expect(before.error.detail).toContain('Pass path (e.g. from workspace.files)');
      expect(before.error.detail).toContain('pass timelineId to generate _taalcut/brief.md');
    }

    // Listing with timelineId writes _taalcut/brief.md via writeReserved without incrementing revision.
    const listed = value<{ revision: number; brief: string }>(
      await world.call('workspace.list', { projectId, timelineId: timeline.id }),
    );
    expect(listed.revision).toBe(0);
    expect(listed.brief).toBe('_taalcut/brief.md');

    // Subsequent workspace.read without timelineId reads the persisted _taalcut/brief.md from head.files!
    const fromList = value<{ path: string; text: string }>(
      await world.call('workspace.read', { projectId, path: '_taalcut/brief.md' }),
    );
    expect(fromList.path).toBe('_taalcut/brief.md');
    expect(fromList.text).toContain('"welcome to the mountain trail"');

    // Also verify workspace.read with timelineId persists to a fresh workspace store.
    const world2 = workspaceWorld(timeline);
    const directRead = value<{ path: string; text: string }>(
      await world2.call('workspace.read', {
        projectId: world2.projectId,
        path: '_taalcut/brief.md',
        timelineId: timeline.id,
      }),
    );
    expect(directRead.text).toContain('"welcome to the mountain trail"');
    const cachedRead = value<{ path: string; text: string }>(
      await world2.call('workspace.read', { projectId: world2.projectId, path: '_taalcut/brief.md' }),
    );
    expect(cachedRead.text).toBe(directRead.text);
  });

  it('deletes existing workspace files, reports missing paths, and increments revision', async () => {
    const timeline = spokenTimeline([[10, 60, 'hello world']]);
    const world = workspaceWorld(timeline);
    const { projectId } = world;

    value(await world.call('workspace.write', { projectId, path: 'cards/one.html', text: '<div>one</div>' }));
    value(await world.call('workspace.write', { projectId, path: 'cards/two.html', text: '<div>two</div>' }));

    const deleted = value<{ revision: number; deleted: string[]; missing: string[] }>(
      await world.call('workspace.delete', {
        projectId,
        paths: ['cards/one.html', 'cards/nonexistent.html'],
      }),
    );
    expect(deleted).toEqual({
      revision: 3,
      deleted: ['cards/one.html'],
      missing: ['cards/nonexistent.html'],
    });

    const listed = value<{ files: { path: string }[] }>(await world.call('workspace.list', { projectId }));
    expect(listed.files.map((file) => file.path)).toEqual(['cards/two.html']);
  });

  it('moves and copies workspace files and honors overwrite: false', async () => {
    const timeline = spokenTimeline([[10, 60, 'hello world']]);
    const world = workspaceWorld(timeline);
    const { projectId } = world;

    value(
      await world.call('workspace.write', { projectId, path: 'scene/main.html', text: '<h1>Title</h1>' }),
    );
    value(await world.call('workspace.write', { projectId, path: 'scene/other.html', text: '<p>Other</p>' }));

    // Copy scene/main.html -> scene/backup.html
    const copied = value<{ revision: number; from: string; to: string; copied: boolean; bytes: number }>(
      await world.call('workspace.move', {
        projectId,
        from: 'scene/main.html',
        to: 'scene/backup.html',
        copy: true,
      }),
    );
    expect(copied).toMatchObject({
      revision: 3,
      from: 'scene/main.html',
      to: 'scene/backup.html',
      copied: true,
    });

    // Refuses overwrite when overwrite: false
    const refused = await world.call('workspace.move', {
      projectId,
      from: 'scene/main.html',
      to: 'scene/other.html',
      overwrite: false,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('core.validation');
      expect(refused.error.detail).toContain('scene/other.html');
    }

    // Move scene/main.html -> scene/renamed.html (deletes source atomically)
    const moved = value<{ revision: number; from: string; to: string; copied: boolean }>(
      await world.call('workspace.move', {
        projectId,
        from: 'scene/main.html',
        to: 'scene/renamed.html',
      }),
    );
    expect(moved).toMatchObject({
      revision: 4,
      from: 'scene/main.html',
      to: 'scene/renamed.html',
      copied: false,
    });

    const listed = value<{ files: { path: string }[] }>(await world.call('workspace.list', { projectId }));
    expect(listed.files.map((file) => file.path).sort()).toEqual([
      'scene/backup.html',
      'scene/other.html',
      'scene/renamed.html',
    ]);
  });

  it('searches across workspace files and _taalcut/brief.md with substring, regex, pathPrefix and caseSensitive', async () => {
    const timeline = spokenTimeline([[10, 60, 'golden hour by the pier']]);
    const world = workspaceWorld(timeline);
    const { projectId } = world;

    value(
      await world.call('workspace.write', {
        projectId,
        path: 'lower-third/index.html',
        text: '<div class="badge">Golden Hour</div>\n<script>gsap.to(".badge", { opacity: 1 });</script>',
      }),
    );
    value(
      await world.call('workspace.write', {
        projectId,
        path: 'outro/index.html',
        text: '<div class="cta">Subscribe Now</div>',
      }),
    );

    // Case-insensitive search including _taalcut/brief.md via timelineId
    const found = value<{
      revision: number;
      totalMatches: number;
      truncated: boolean;
      matches: { path: string; line: number; column: number; text: string }[];
    }>(
      await world.call('workspace.search', {
        projectId,
        query: 'golden hour',
        timelineId: timeline.id,
      }),
    );
    expect(found.totalMatches).toBeGreaterThanOrEqual(2);
    expect(found.matches.map((m) => m.path)).toContain('lower-third/index.html');
    expect(found.matches.map((m) => m.path)).toContain('_taalcut/brief.md');

    // Case-sensitive + pathPrefix + regex search
    const regexSearch = value<{
      totalMatches: number;
      matches: { path: string; line: number; column: number; text: string }[];
    }>(
      await world.call('workspace.search', {
        projectId,
        query: 'gsap\\.to\\("[^"]+"',
        pathPrefix: 'lower-third/',
        caseSensitive: true,
        regex: true,
      }),
    );
    expect(regexSearch.totalMatches).toBe(1);
    expect(regexSearch.matches[0]).toMatchObject({
      path: 'lower-third/index.html',
      line: 2,
    });
  });

  it('serves taalcut/sandbox-workspace from workspace.docs and references workspace.render/renderOver in three-3d', async () => {
    const timeline = spokenTimeline([[10, 60, 'hello']]);
    const world = workspaceWorld(timeline);

    const index = value<{ note: string; topics: { topic: string }[] }>(
      await world.call('workspace.docs', {}),
    );
    expect(index.note).toContain('taalcut/sandbox-workspace');
    expect(index.topics.map((t) => t.topic)).toContain('taalcut/sandbox-workspace');

    const sandboxDoc = value<{ text: string }>(
      await world.call('workspace.docs', { topic: 'taalcut/sandbox-workspace' }),
    );
    expect(sandboxDoc.text).toContain('workspace.delete');
    expect(sandboxDoc.text).toContain('workspace.move');
    expect(sandboxDoc.text).toContain('workspace.search');
    expect(sandboxDoc.text).toContain('libopenh264');
    expect(sandboxDoc.text).toContain('chrome-headless-shell');

    const threeDoc = value<{ text: string }>(
      await world.call('workspace.docs', { topic: 'taalcut/three-3d' }),
    );
    expect(threeDoc.text).not.toContain('workspace.frames');
    expect(threeDoc.text).toContain('workspace.render');
  });

  it('pages large workspace files under 8,192 UTF-8 JSON bytes per page', async () => {
    const timeline = spokenTimeline([[10, 60, 'hello']]);
    const world = workspaceWorld(timeline);
    const { projectId } = world;
    const largeText = Array.from({ length: 200 }, (_, i) => `line-${i}: ${'x'.repeat(65)}`).join('\n');
    value(await world.call('workspace.write', { projectId, path: 'notes/large.txt', text: largeText }));
    const page1 = value<{ page: number; pages: number; text: string }>(
      await world.call('workspace.read', { projectId, path: 'notes/large.txt', page: 1 }),
    );
    expect(page1.pages).toBeGreaterThan(2);
    expect(Buffer.byteLength(JSON.stringify(page1), 'utf8')).toBeLessThan(8_192);
  });
});
