// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  newId,
  timelineSchema,
  unwrap,
  type CommandToolContext,
  type TextItem,
  type Timeline,
} from '@taalcut/core';
import { createDesignTool } from '../../src/compositions/design-tool';
import { briefText } from '../../src/workspace/tools/brief';
import { makeTimeline } from '../support/timeline';
import { workspaceWorld } from '../workspace/tools/support';

const ui = { source: 'ui', actor: 'user' } as const;
const textItems = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));

async function nativeTitles() {
  const base = makeTimeline({
    items: [{ frames: 180 }],
    texts: [
      { start: 0, frames: 90, text: 'That airport feeling' },
      { start: 90, frames: 60, text: 'Never gets old' },
      { start: 150, frames: 30, text: 'Keep this unchanged' },
    ],
  });
  const timeline = timelineSchema.parse({
    ...base,
    tracks: base.tracks.map((track) =>
      track.kind !== 'text'
        ? track
        : {
            ...track,
            items: track.items.map((item, index) => ({
              ...item,
              overlayId: newId<'TextOverlay'>(),
              origin: index === 0 ? 'user' : 'editor',
            })),
          },
    ),
  });
  const originals = textItems(timeline) as TextItem[];
  const world = workspaceWorld(timeline);
  const html = await readFile(join(import.meta.dirname, '../workspace/tools/fixtures/bubble.html'), 'utf8');
  unwrap(
    await world.call('workspace.write', {
      projectId: timeline.projectId,
      path: 'title/index.html',
      text: html,
    }),
  );
  const input = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    revision: timeline.revision,
    entry: 'title/index.html',
    itemIds: originals.slice(0, 2).map((item) => item.id),
    name: 'Airport titles',
    request: 'Center the titles and give them a better style',
  };
  return { timeline, originals, world, input, html };
}

describe('restyling native text without duplicate titles', () => {
  it('gives the designer the original words, item ids, pixel boxes and cap heights before a restyle', async () => {
    const { timeline, originals } = await nativeTitles();
    const brief = briefText({ timeline });
    for (const item of originals) {
      expect(brief).toContain(`${item.id} `);
      expect(brief).toContain(`native text "${item.text}"`);
      expect(brief).toContain(`capHeightPx ${Math.round(item.appearance.size * timeline.canvas.height)}`);
    }
    expect(brief).toContain('"width":864');
    expect(brief).toContain('cap height / canvas height, not CSS font-size');
    expect(brief).toContain('preserve its words and visual prominence');
    expect(brief).toContain('x 54–1026 px');
    expect(brief).toContain('horizontal center is x 540 px');
    expect(brief).toContain('0.5 to 600 s');
  });

  it('replaces both titles atomically, keeping their words, ids and timing; undo and redo restore exactly one version', async () => {
    const { timeline, originals, world, input } = await nativeTitles();
    const done = await world.call('workspace.replace', input);
    expect(done.ok, JSON.stringify(done)).toBe(true);
    const result = unwrap(done);
    expect(result.itemIds).toEqual(input.itemIds);
    const after = timelineSchema.parse(unwrap(await world.store.get(timeline.id)));
    const items = textItems(after);
    expect(items).toHaveLength(originals.length);
    expect(items.slice(0, 2)).toEqual(
      originals.slice(0, 2).map((item) =>
        expect.objectContaining({
          type: 'graphic',
          id: item.id,
          start: item.start,
          duration: item.duration,
          anchor: { kind: 'time', at: item.start },
          language: item.language,
          origin: item.origin === 'user' ? 'user' : 'agent',
          overlay: { id: item.overlayId, words: item.origin },
          composition: expect.objectContaining({ params: { message: item.text } }),
        }),
      ),
    );
    expect(items[2]).toEqual(originals[2]);
    expect(after.tracks.filter((track) => track.kind !== 'text')).toEqual(
      timeline.tracks.filter((track) => track.kind !== 'text'),
    );
    unwrap(await world.bus.undo(timeline.projectId, ui));
    expect(textItems(unwrap(await world.store.get(timeline.id)))).toEqual(originals);
    unwrap(await world.bus.redo(timeline.projectId, ui));
    expect(textItems(unwrap(await world.store.get(timeline.id)))).toEqual(items);
  });

  it('refuses all changes when any target is missing or the text variable is ambiguous', async () => {
    const { timeline, originals, world, input, html } = await nativeTitles();
    const missing = await world.call('workspace.replace', {
      ...input,
      itemIds: [input.itemIds[0], newId<'TimelineItem'>()],
    });
    expect(missing.ok ? '' : missing.error.code).toBe('core.not_found');
    expect(textItems(unwrap(await world.store.get(timeline.id)))).toEqual(originals);
    // The design must say where every existing title's words belong, never fall back to a sample.
    const colourOnly = html
      .replace(/data-var-text="message"/g, '')
      .replace(/\{\s*"id":\s*"message"[^}]*\},?\s*/, '');
    unwrap(
      await world.call('workspace.write', {
        projectId: timeline.projectId,
        path: 'title/index.html',
        text: colourOnly,
      }),
    );
    const ambiguous = await world.call('workspace.replace', input);
    expect(ambiguous.ok ? '' : ambiguous.error.detail).toContain('exactly one text variable');
    expect(textItems(unwrap(await world.store.get(timeline.id)))).toEqual(originals);
  });

  it('accepts native text ids for design jobs and rejects a video clip id before any mutation', async () => {
    const { timeline, world, input } = await nativeTitles();
    const tool = createDesignTool({ timelines: world.store });
    const ctx = {
      signal: new AbortController().signal,
      callId: newId<'ToolRun'>(),
      runId: newId<'AgentRun'>(),
    } as CommandToolContext;
    const job = {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      request: input.request,
      itemIds: input.itemIds,
    };
    expect(unwrap(await tool.run(tool.input.parse(job), ctx)).itemIds).toEqual(input.itemIds);
    const withTimelineTargetAndAt = unwrap(
      await tool.run(
        tool.input.parse({
          projectId: timeline.projectId,
          timelineId: timeline.id,
          request: 'Add location tags',
          target: { kind: 'timeline', timelineId: timeline.id },
          at: 0,
        }),
        ctx,
      ),
    );
    expect(withTimelineTargetAndAt.at).toBe(0);
    expect(withTimelineTargetAndAt.target).toBeUndefined();
    const videoId = timeline.tracks.find((track) => track.kind === 'video')!.items[0]!.id;
    const refused = await tool.run(tool.input.parse({ ...job, itemIds: [videoId] }), ctx);
    expect(refused.ok ? '' : refused.error.code).toBe('core.not_found');
    expect(unwrap(await world.store.get(timeline.id))).toEqual(timeline);
  });
});
