// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: pruning keeps every blob a revision, a timeline's composition copy (or a saved version's) or a template's
 * composition names, spares young unnamed blobs (a tool's put before its write), deletes the rest and the folders of
 * projects that are gone, and removes links planted in the folder without touching what they point at. DSG2: the
 * still of each design a graphic offers is kept as long as the graphic offers it (on the timeline or a saved version).
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  newId,
  RationalTime,
  unwrap,
  type GraphicComposition,
  type GraphicItem,
  type ProjectId,
  type Timeline,
  type WorkspaceFile,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTemplateStore } from '../../src/index';
import { tempDir } from '../helpers';
import { template } from './documents';
import {
  bytes,
  code,
  compositionOf,
  setup,
  withProject,
  writeFiles,
  type WorkspaceSetup,
} from './workspace-setup';

const HOUR = 60 * 60_000;
const later = () => Date.now() + 2 * HOUR;

async function file(world: WorkspaceSetup, projectId: ProjectId, path: string, content: string) {
  const put = unwrap(await world.store.putBlob(projectId, bytes(content)));
  return { path, sha256: put.sha256, bytes: put.bytes } satisfies WorkspaceFile;
}

const present = async (world: WorkspaceSetup, projectId: ProjectId, sha256: string) =>
  (await world.store.readBlob(projectId, sha256)).ok;

describe('workspace prune (HFW1-WS)', () => {
  it('keep what revisions, timeline copies and templates name; delete the rest once it is old', async () => {
    const world = await setup();
    const { projectId, timeline, timelineId } = await withProject(world);
    // In an old revision only: an undo can bring it back.
    unwrap(await writeFiles(world, projectId, { 'old.css': '.old{}' }));
    const old = unwrap(await world.store.head(projectId))!.files[0]!;
    unwrap(await writeFiles(world, projectId, { 'old.css': null, 'new.css': '.new{}' }));
    // A copy saved in a version of the timeline (a person can restore it), then replaced on the working copy.
    const saved = await file(world, projectId, 'card/saved.html', '<p>saved</p>');
    const stored = unwrap(await world.timelines.get(timelineId));
    unwrap(
      await world.timelines.put(
        { ...timeline, graphicCompositions: [compositionOf([saved])] },
        stored.summary.revision,
      ),
    );
    unwrap(world.timelines.versions.snapshot({ timelineId, kind: 'named', label: 'Before' }));
    const copied = await file(world, projectId, 'card/index.html', '<p>copy</p>');
    unwrap(
      await world.timelines.put(
        { ...timeline, name: 'v2', graphicCompositions: [compositionOf([copied])] },
        stored.summary.revision + 1,
      ),
    );
    // A template's composition.
    const templates = createTemplateStore(world.db, { assetsDir: join(tempDir(), 'assets') });
    const forTemplate = await file(world, projectId, 'tpl/index.html', '<p>template</p>');
    const doc = template({ sheet: null });
    unwrap(
      await templates.create(
        { ...doc, graphics: { uses: [], compositions: [compositionOf([forTemplate])] } },
        { name: 'Made-up reel', projectId: null, listed: true },
      ),
    );
    const unnamed = await file(world, projectId, 'loose.css', '.loose{}');

    // Young: nothing goes yet.
    expect(unwrap(await world.store.prune())).toEqual({ blobs: 0, folders: 0, links: 0 });
    const report = unwrap(await world.store.prune({ now: later }));
    expect(report.blobs).toBe(1);
    expect(await present(world, projectId, unnamed.sha256)).toBe(false);
    for (const kept of [old, saved, copied, forTemplate])
      expect(await present(world, projectId, kept.sha256), kept.path).toBe(true);
  });

  it('keep the still of every design a graphic offers, on the timeline and on a saved version (DSG2)', async () => {
    const world = await setup();
    const { projectId, timeline, timelineId } = await withProject(world);
    const still = async (name: string) => {
      const put = unwrap(await world.store.putBlob(projectId, bytes(`jpeg ${name}`)));
      return { sha256: put.sha256, bytes: put.bytes, mimeType: 'image/jpeg' as const };
    };
    const rate = timeline.canvas.rate;
    const at = (frames: number) => RationalTime.of(frames, rate);
    /** The timeline with one graphic offering `designs` (the first in use), each with its still. */
    const offering = async (names: readonly string[]): Promise<{ doc: Timeline; stills: string[] }> => {
      const copies: GraphicComposition[] = [];
      const designs = [];
      for (const name of names) {
        const copy = compositionOf([await file(world, projectId, `${name}/index.html`, `<p>${name}</p>`)]);
        copies.push(copy);
        designs.push({ compositionId: copy.id, idea: `Idea ${name}`, still: await still(name) });
      }
      const graphic: GraphicItem = {
        type: 'graphic',
        id: newId<'TimelineItem'>(),
        anchor: { kind: 'time', at: at(0) },
        start: at(0),
        duration: at(30),
        placement: { box: { x: 0, y: 0, width: 1, height: 1 } },
        styleKey: 'composition',
        language: null,
        origin: 'agent',
        composition: { id: copies[0]!.id, hash: copies[0]!.hash, params: { words: 'Leave' } },
        options: { set: newId<'GraphicOptionSet'>(), request: 'a title', createdAt: 1, designs },
      };
      return {
        doc: {
          ...timeline,
          tracks: [...timeline.tracks, { kind: 'text', id: 'T9', name: '', enabled: true, items: [graphic] }],
          graphicCompositions: copies,
        },
        stills: designs.map((design) => design.still.sha256),
      };
    };
    // Three designs saved in a version; then the person asks again and the working copy offers two new ones.
    const first = await offering(['a', 'b', 'c']);
    const stored = unwrap(await world.timelines.get(timelineId));
    unwrap(await world.timelines.put(first.doc, stored.summary.revision));
    unwrap(world.timelines.versions.snapshot({ timelineId, kind: 'named', label: 'First designs' }));
    const second = await offering(['d', 'e']);
    unwrap(await world.timelines.put(second.doc, stored.summary.revision + 1));
    // A still nothing offers (a design that was dropped before it was placed).
    const dropped = await still('dropped');

    const report = unwrap(await world.store.prune({ now: later }));
    expect(report.blobs).toBe(1);
    expect(await present(world, projectId, dropped.sha256)).toBe(false);
    for (const kept of [...first.stills, ...second.stills])
      expect(await present(world, projectId, kept), kept).toBe(true);
  });

  it('spare a blob put again just now, which a write is about to name', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const loose = await file(world, projectId, 'a.css', '.a{}');
    const path = join(
      world.dataRoot,
      'workspaces',
      projectId,
      'blobs',
      loose.sha256.slice(0, 2),
      loose.sha256,
    );
    const longAgo = new Date(Date.now() - 3 * HOUR);
    expect(unwrap(await world.store.prune()).blobs).toBe(0);
    // Put long ago and named by nothing; then put again, as a tool does right before its write.
    utimesSync(path, longAgo, longAgo);
    unwrap(await world.store.putBlob(projectId, bytes('.a{}')));
    expect(unwrap(await world.store.prune()).blobs).toBe(0);
    utimesSync(path, longAgo, longAgo);
    expect(unwrap(await world.store.prune()).blobs).toBe(1);
  });

  it('delete the folder of a project that is gone, and links without what they point at', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    unwrap(await writeFiles(world, projectId, { 'a.css': '.a{}' }));
    const root = join(world.dataRoot, 'workspaces');
    const gone = newId<'Project'>();
    mkdirSync(join(root, gone, 'blobs', 'ab'), { recursive: true });
    writeFileSync(join(root, gone, 'blobs', 'ab', 'ab'.repeat(32)), 'orphan');
    // Not a project folder of ours: left alone.
    mkdirSync(join(root, 'not-a-project'));
    const outside = tempDir();
    writeFileSync(join(outside, 'keep.txt'), 'outside');
    symlinkSync(outside, join(root, newId<'Project'>()));
    symlinkSync(outside, join(root, projectId, 'blobs', 'cd'));
    const report = unwrap(await world.store.prune({ now: later }));
    expect(report).toEqual({ blobs: 0, folders: 1, links: 2 });
    expect(existsSync(join(root, gone))).toBe(false);
    expect(existsSync(join(root, 'not-a-project'))).toBe(true);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('outside');
    expect(code(await world.store.head(projectId))).toBe('ok');
    expect(Object.keys(unwrap(await world.store.head(projectId))!.files)).toHaveLength(1);
  });

  it('do nothing where there is no workspaces folder, or where it is a link', async () => {
    const world = await setup();
    expect(unwrap(await world.store.prune())).toEqual({ blobs: 0, folders: 0, links: 0 });
    const outside = tempDir();
    mkdirSync(join(outside, newId<'Project'>()));
    symlinkSync(outside, join(world.dataRoot, 'workspaces'));
    expect(unwrap(await world.store.prune({ now: later }))).toEqual({ blobs: 0, folders: 0, links: 0 });
  });
});
