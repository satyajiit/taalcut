// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1's contract, the calls: the workspace's commands and their path rules, placing and redesigning a composition
 * graphic, the render worker's stills, the Editor's design job, the changes card's design row and a tool's pictures.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  connectRpc,
  defineTool,
  diffEdits,
  editChangeSchema,
  editSnapshot,
  GRAPHICS_COMMANDS,
  GRAPHICS_DESIGN_TOOL,
  graphicsCommandPayloads,
  graphicsDesignJobSchema,
  newId,
  NO_TOOL_RETRY,
  ok,
  renderWorkerContract,
  renderWorkerOverRpc,
  renderWorkerRouter,
  serveRpc,
  toolSpecProblems,
  WORKSPACE_COMMANDS,
  WORKSPACE_FRAMES_MAX,
  workspaceCommandPayloads,
  workspaceFramesInputSchema,
  workspaceFramesOutputSchema,
  WORKSPACE_OVER_IMAGE_BYTES,
  graphicCompositionSchema,
  type ArtifactRef,
  type GraphicItem,
  type RenderWorker,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { at, ntscTimeline } from './helpers/documents';
import { COMPOSITION, FILES, ntsc, sha } from './helpers/hfw1';
import { channel } from './helpers/ports';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const writeFiles = workspaceCommandPayloads[WORKSPACE_COMMANDS.writeFiles];
const write = (files: unknown[]) => writeFiles.safeParse({ projectId, baseRevision: 0, files });

describe('HFW1: the workspace’s commands (contract)', () => {
  it('names them', () => {
    expect(WORKSPACE_COMMANDS).toEqual({ writeFiles: 'workspace.writeFiles', restore: 'workspace.restore' });
  });

  it('writeFiles takes files by hash and deletes, each path once, at most 32', () => {
    expect(
      write([
        { path: 'index.html', sha256: sha('a') },
        { path: 'old.css', delete: true },
      ]).success,
    ).toBe(true);
    expect(write([]).success).toBe(false);
    expect(
      write([
        { path: 'a.html', sha256: sha('a') },
        { path: 'a.html', delete: true },
      ]).success,
    ).toBe(false);
    const many = Array.from({ length: 33 }, (_, n) => ({ path: `f${n}.css`, sha256: sha('a') }));
    expect(write(many.slice(0, 32)).success).toBe(true);
    expect(write(many).success).toBe(false);
    // One shape or the other, and never a file's text.
    expect(write([{ path: 'a.html', sha256: sha('a'), delete: true }]).success).toBe(false);
    expect(write([{ path: 'a.html', delete: false }]).success).toBe(false);
    expect(write([{ path: 'a.html', text: '<div></div>' }]).success).toBe(false);
    expect(
      writeFiles.safeParse({ projectId, baseRevision: -1, files: [{ path: 'a', delete: true }] }).success,
    ).toBe(false);
  });

  it('refuses any path that leaves the workspace', () => {
    for (const path of ['/Users/x/a.html', '../a.html', 'a/../../b', '.env', 'a\\b.css', '~/a', 'C:/a'])
      expect(write([{ path, sha256: sha('a') }]).success, path).toBe(false);
  });

  it('restore takes a revision, 0 being the empty workspace', () => {
    const restore = workspaceCommandPayloads[WORKSPACE_COMMANDS.restore];
    expect(restore.safeParse({ projectId, revision: 0 }).success).toBe(true);
    expect(restore.safeParse({ projectId, revision: -1 }).success).toBe(false);
  });
});

describe('HFW1: placing and redesigning a composition graphic (contract)', () => {
  const place = graphicsCommandPayloads[GRAPHICS_COMMANDS.placeComposition];
  const set = graphicsCommandPayloads[GRAPHICS_COMMANDS.setComposition];
  const proposal = {
    request: 'a message bubble that says leaving in five',
    design: 'designed',
    createdAt: 1,
  };
  const placing = {
    projectId,
    timelineId,
    composition: COMPOSITION,
    params: { message: 'Leaving in five' },
    anchor: { kind: 'phrase', text: 'leaving', occurrence: 1 },
    proposal,
  };

  it('names them', () => {
    expect(GRAPHICS_COMMANDS.placeComposition).toBe('graphics.placeComposition');
    expect(GRAPHICS_COMMANDS.setComposition).toBe('graphics.setComposition');
  });

  it('placeComposition is a designed proposal of a composition that passed the gate', () => {
    expect(place.parse({ ...placing, params: undefined }).params).toEqual({});
    const again = { ...placing, replaces: newId<'TimelineItem'>(), duration: at(90, ntsc), scale: 1.2 };
    expect(place.safeParse(again).success).toBe(true);
    const failed = { ...COMPOSITION, gate: { ...COMPOSITION.gate, passed: false } };
    expect(place.safeParse({ ...placing, composition: failed }).success).toBe(false);
    const kit = { ...proposal, design: 'kit', kitReason: 'onDevice' };
    expect(place.safeParse({ ...placing, proposal: kit }).success).toBe(false);
    expect(place.safeParse({ ...placing, proposal: undefined }).success).toBe(false);
    expect(place.safeParse({ ...placing, duration: at(20, { num: 1, den: 1 }) }).success).toBe(true);
    expect(place.safeParse({ ...placing, duration: at(601, { num: 1, den: 1 }) }).success).toBe(false);
  });

  it('setComposition gives graphics a new design, each once', () => {
    const itemId = newId<'TimelineItem'>();
    const next = { ...COMPOSITION, version: 2, hash: sha('e') };
    expect(set.safeParse({ projectId, timelineId, itemIds: [itemId], composition: next }).success).toBe(true);
    expect(
      set.safeParse({ projectId, timelineId, itemIds: [itemId, itemId], composition: next }).success,
    ).toBe(false);
    expect(set.safeParse({ projectId, timelineId, itemIds: [], composition: next }).success).toBe(false);
  });
});

describe('HFW1: the render worker’s workspace stills (contract)', () => {
  const input = {
    projectId,
    entry: 'bubble/index.html',
    files: FILES,
    seconds: [0.2, 1.5, 2.8],
    over: { kind: 'footage', timelineId, start: 4, leaveOut: [newId<'TimelineItem'>()] },
  };

  it('takes up to 12 seconds over the footage or grey', () => {
    expect(WORKSPACE_FRAMES_MAX).toBe(12);
    expect(workspaceFramesInputSchema.parse(input).maxDimension).toBe(768);
    expect(workspaceFramesInputSchema.safeParse({ ...input, over: { kind: 'grey' } }).success).toBe(true);
    const thirteen = Array.from({ length: 13 }, (_, n) => n);
    expect(workspaceFramesInputSchema.safeParse({ ...input, seconds: thirteen }).success).toBe(false);
    expect(workspaceFramesInputSchema.safeParse({ ...input, entry: '../x.html' }).success).toBe(false);
  });

  it('draws over a PNG or JPEG of at most 4 MiB, and nothing that is not what it says (HFW1-TPL)', () => {
    const over = (mimeType: string, dataBase64: string) =>
      workspaceFramesInputSchema.safeParse({ ...input, over: { kind: 'image', mimeType, dataBase64 } })
        .success;
    expect(WORKSPACE_OVER_IMAGE_BYTES).toBe(4 * 1024 * 1024);
    expect(over('image/png', 'iVBORw0KGgoAAAANSUhEUg==')).toBe(true);
    expect(over('image/jpeg', '/9j/4AAQSkZJRgABAQ==')).toBe(true);
    // A GIF, a JPEG called a PNG, text that isn't base64, and a picture over the cap.
    expect(over('image/gif', 'R0lGODlhAQABAA==')).toBe(false);
    expect(over('image/png', '/9j/4AAQSkZJRgABAQ==')).toBe(false);
    expect(over('image/jpeg', '/9j/<script>')).toBe(false);
    const big = `/9j/${'A'.repeat(Math.ceil(WORKSPACE_OVER_IMAGE_BYTES / 3) * 4)}`;
    expect(over('image/jpeg', big)).toBe(false);
  });

  it('says where the drawn content sits in each still, unclamped, or that none shows (HFW1-TPL)', () => {
    const still = { seconds: 1, mimeType: 'image/jpeg', dataBase64: 'AAAA', width: 432, height: 768 };
    const parse = (extra: object) =>
      workspaceFramesOutputSchema.safeParse({ frames: [{ ...still, ...extra }], checks: [], ms: 5 }).success;
    expect(parse({})).toBe(true);
    expect(parse({ box: null })).toBe(true);
    expect(parse({ box: { x: 0.55, y: 0.42, width: 0.38, height: 0.05 } })).toBe(true);
    // Off the right edge: past 1, kept so the bounds check sees it.
    expect(parse({ box: { x: 0.8, y: 0.42, width: 0.38, height: 0.05 } })).toBe(true);
    expect(parse({ box: { x: 0.8, y: 0.42, width: -1, height: 0.05 } })).toBe(false);
  });

  it('says how many lines its words sit on, when the worker measures it (HFW1-TPL)', () => {
    const still = { seconds: 1, mimeType: 'image/jpeg', dataBase64: 'AAAA', width: 432, height: 768 };
    const parse = (extra: object) =>
      workspaceFramesOutputSchema.safeParse({ frames: [{ ...still, ...extra }], checks: [], ms: 5 }).success;
    expect(parse({ lines: 2 })).toBe(true);
    expect(parse({ lines: 0, box: null })).toBe(true);
    expect(parse({ lines: 1.5 })).toBe(false);
    expect(parse({ lines: -1 })).toBe(false);
  });

  it('says its words’ type size and padding as drawn, when the worker measures it (HFW1-TPL)', () => {
    const still = { seconds: 1, mimeType: 'image/jpeg', dataBase64: 'AAAA', width: 432, height: 768 };
    const parse = (extra: object) =>
      workspaceFramesOutputSchema.safeParse({ frames: [{ ...still, ...extra }], checks: [], ms: 5 }).success;
    const padding = { top: 25, right: 47, bottom: 25, left: 47 };
    expect(parse({ type: { fontPx: 54, padding } })).toBe(true);
    expect(parse({})).toBe(true);
    expect(parse({ type: { fontPx: -1, padding } })).toBe(false);
    expect(parse({ type: { fontPx: 54 } })).toBe(false);
  });

  it('crosses IPC, and is not implemented where nothing draws', async () => {
    const base: RenderWorker = {
      export: async () => ok({} as never),
      captureFrame: async () => ok({} as never),
    };
    const connect = (worker: RenderWorker) => {
      const { port1, port2 } = channel();
      serveRpc(renderWorkerRouter(worker), port1, { context: {} });
      return renderWorkerOverRpc(() => connectRpc(renderWorkerContract, port2, { peer: 'render' }).client);
    };
    const frame = { mimeType: 'image/jpeg' as const, dataBase64: 'AAAA', width: 432, height: 768 };
    const drawing = connect({
      ...base,
      workspaceFrames: async (asked) =>
        ok({
          frames: asked.seconds.map((seconds) => ({ seconds, ...frame })),
          checks: [
            { id: 'bounds', status: 'fail', detail: 'The bubble runs off the right edge: add max-width' },
          ],
          ms: 1200,
        }),
    });
    const drawn = await drawing.workspaceFrames!(input as never);
    expect(drawn.ok && drawn.value.frames.map((still) => still.seconds)).toEqual([0.2, 1.5, 2.8]);
    expect(await connect(base).workspaceFrames!(input as never)).toMatchObject({
      ok: false,
      error: { code: 'core.not_implemented' },
    });
  });
});

describe('HFW1: the Editor’s design job (contract)', () => {
  const request = 'Make the chat bubbles look like the reel’s';

  it('takes the request as said, the graphics, where, and the comment', () => {
    expect(GRAPHICS_DESIGN_TOOL).toBe('graphics.design');
    const itemIds = [newId<'TimelineItem'>(), newId<'TimelineItem'>()];
    const commentId = newId<'TimelineComment'>();
    expect(graphicsDesignJobSchema.parse({ request, itemIds, commentId })).toEqual({
      request,
      itemIds,
      commentId,
    });
    expect(graphicsDesignJobSchema.safeParse({ request: 'a countdown', at: 4 }).success).toBe(true);
    expect(graphicsDesignJobSchema.safeParse({ request: 'a pin', phrase: 'we landed' }).success).toBe(true);
  });

  it('says where once, and converts to JSON Schema for the model', () => {
    expect(graphicsDesignJobSchema.safeParse({ request, at: 4, phrase: 'we landed' }).success).toBe(false);
    expect(graphicsDesignJobSchema.safeParse({ request: ' ' }).success).toBe(false);
    expect(graphicsDesignJobSchema.safeParse({ request, itemIds: [] }).success).toBe(false);
    const schema = z.toJSONSchema(graphicsDesignJobSchema, { io: 'input' }) as { properties: object };
    expect(Object.keys(schema.properties)).toEqual([
      'request',
      'itemIds',
      'at',
      'phrase',
      'target',
      'commentId',
    ]);
  });
});

describe('HFW1: the changes card’s design row (contract)', () => {
  type Text = Extract<Track, { kind: 'text' }>;
  const v1 = graphicCompositionSchema.parse(COMPOSITION);
  const v2 = graphicCompositionSchema.parse({ ...COMPOSITION, version: 2, hash: sha('e') });
  const item: GraphicItem = {
    type: 'graphic',
    id: newId<'TimelineItem'>(),
    anchor: { kind: 'time', at: at(70, ntsc) },
    start: at(70, ntsc),
    duration: at(60, ntsc),
    placement: 'bottom',
    styleKey: 'graphic',
    language: 'en',
    origin: 'agent',
    composition: { id: v1.id, hash: v1.hash, params: { message: 'Leaving in five' } },
  };
  const base = ntscTimeline();
  const timeline = (graphic: GraphicItem, revision: number): Timeline => {
    const text = base.tracks[2] as Text;
    return {
      ...base,
      revision,
      tracks: [base.tracks[0]!, base.tracks[1]!, { ...text, items: [...text.items, graphic] }],
      graphicCompositions: [v1, v2],
    };
  };
  const redesigned = { ...item, composition: { ...item.composition!, hash: v2.hash } };

  it('says a graphic’s new design and whether it is still proposed', () => {
    const rows = diffEdits(editSnapshot(timeline(item, 1)), editSnapshot(timeline(redesigned, 2))).changes;
    expect(rows.map((row) => row.change)).toEqual([
      {
        kind: 'design',
        before: { name: 'Message bubble', version: 1 },
        after: { name: 'Message bubble', version: 2 },
        proposed: false,
      },
    ]);
    expect(editChangeSchema.safeParse(rows[0]!.change).success).toBe(true);
    const proposal = { request: 'make it pop more', design: 'designed', createdAt: 1 } as const;
    const proposed = diffEdits(
      editSnapshot(timeline({ ...item, proposal }, 1)),
      editSnapshot(timeline({ ...redesigned, proposal }, 2)),
    ).changes;
    expect(proposed[0]?.change).toMatchObject({ kind: 'design', proposed: true });
  });

  it('a snapshot from before HFW1 (no design facts) gives no design row', () => {
    const snapshot = editSnapshot(timeline(item, 1));
    const old = { ...snapshot, items: snapshot.items.map(({ design: _d, proposed: _p, ...rest }) => rest) };
    const kinds = diffEdits(old, editSnapshot(timeline(redesigned, 2))).changes.map((row) => row.change.kind);
    expect(kinds).not.toContain('design');
  });
});

describe('HFW1: a tool’s pictures (contract)', () => {
  it('a tool may say which artifacts of its output are images', () => {
    const still: ArtifactRef = {
      id: newId<'Artifact'>(),
      mediaType: 'image/jpeg',
      bytes: 9000,
      summary: 'Still at 1.5 s',
    };
    const tool = defineTool({
      name: 'workspace.render',
      version: '1.0.0',
      description: 'Renders stills of a composition.',
      input: z.object({}),
      output: z.object({ stills: z.array(z.custom<ArtifactRef>()) }),
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 60_000,
      retry: NO_TOOL_RETRY,
      images: (output) => output.stills,
      run: async () => ok({ stills: [still] }),
    });
    expect(toolSpecProblems(tool)).toEqual([]);
    expect(tool.images?.({ stills: [still] })).toEqual([still]);
  });
});
