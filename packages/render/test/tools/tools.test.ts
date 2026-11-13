// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's tool modules: well formed for the registry (core's checks and a
 * JSON Schema the model can read), render.export asks with the export card
 * and follows its job, and the read tools return no paths.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  err,
  newId,
  NotImplementedError,
  ok,
  parseCard,
  toolModuleProblems,
  unwrap,
  type AnyTool,
  type AsyncResult,
  type CommandToolContext,
  type ArtifactId,
  type ArtifactInput,
  type ArtifactRef,
  type JobRunner,
  type RenderWorker,
} from '@taalcut/core';
import { createRenderCommands } from '../../src/commands/render-commands';
import { autoFix, checkResult } from '../../src/qa/result';
import { captionToolModule } from '../../src/tools/caption-tools';
import { BUILT_PRESET_IDS, EXPORT_PRESETS } from '../../src/presets/presets.v1';
import { timelineToolModule } from '../../src/tools/capture-frame-tool';
import { musicToolModule } from '../../src/tools/music-tools';
import { renderToolModule } from '../../src/tools/render-tools';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';
import { report } from '../qa/support';
import { AGENT, memoryTimelines, recordingEnqueuer } from '../commands/support';

const worker: RenderWorker = {
  export: async () => err(NotImplementedError()),
  captureFrame: async (input) =>
    ok({
      frame: input.frame,
      at: { value: input.frame, rate: { num: 30, den: 1 } } as never,
      mimeType: 'image/jpeg' as const,
      dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
      width: 432,
      height: 768,
      visible: { clips: ['c1'], captions: [], texts: [] },
      textBoxes: [
        {
          kind: 'text' as const,
          id: 't1',
          box: { x: 10, y: 20, width: 30, height: 40 },
          lines: 1,
          inSafeZone: false,
        },
      ],
    }),
};

function context(dispatch?: (payload: unknown) => AsyncResult<unknown>) {
  const stored: { input: ArtifactInput; ref: ArtifactRef }[] = [];
  const progress: number[] = [];
  const ctx: CommandToolContext = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      async put(input) {
        const data = typeof input.data === 'string' ? Buffer.from(input.data) : input.data;
        const ref = {
          id: newId<'Artifact'>() as ArtifactId,
          mediaType: input.mediaType,
          bytes: data.length,
          summary: input.summary,
        };
        stored.push({ input, ref });
        return ok(ref);
      },
      get: async () => err(NotImplementedError()),
    },
    reportUsage: () => undefined,
    reportProgress: (fraction) => progress.push(fraction),
    dispatch: dispatch ?? (async () => ok(null)),
  };
  return { ctx, stored, progress };
}

const modules = () => [
  renderToolModule({ store: memoryRenderStore(), timelines: memoryTimelines() }),
  timelineToolModule({ worker }),
  captionToolModule(),
  musicToolModule(),
];

describe('render tool modules', () => {
  it('pass the registry’s checks and export to JSON Schema', () => {
    for (const module of modules()) {
      expect(toolModuleProblems(module)).toEqual([]);
      for (const tool of module.tools as readonly AnyTool[]) {
        const input = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'throw' });
        z.toJSONSchema(tool.output, { io: 'output', unrepresentable: 'throw' });
        expect(input.type, tool.name).toBe('object');
      }
    }
  });

  it('offer only the presets this build renders; frame overlays only for portrait presets', () => {
    expect(BUILT_PRESET_IDS).toEqual(EXPORT_PRESETS.map((preset) => preset.id));
    const capture = timelineToolModule({ worker }).tools[0]!;
    const overlay = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      frame: 0,
      source: { kind: 'preview' },
    };
    expect(capture.input.safeParse({ ...overlay, overlayPresetId: 'reels' }).success).toBe(true);
    expect(capture.input.safeParse({ ...overlay, overlayPresetId: 'landscape' }).success).toBe(false);
  });
});

describe('render.export', () => {
  function setup() {
    const timeline = makeTimeline({ items: [{ frames: 90 }] });
    const store = memoryRenderStore();
    const settings = createMemorySettingsStore();
    const timelines = memoryTimelines(timeline);
    const clock = createManualClock(1_000);
    const commands = createRenderCommands({
      store,
      enqueuer: recordingEnqueuer(),
      timelines,
      settings,
      clock,
    });
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
    bus.register(...commands.all);
    const runs: { kind: string; input: unknown; key: string | undefined }[] = [];
    const jobs: JobRunner = {
      async run(kind, input, options = {}) {
        runs.push({ kind: kind.kind, input, key: options.idempotencyKey });
        options.onProgress?.({ fraction: 0.5 });
        const { renderId } = input as { renderId: Parameters<typeof store.get>[0] };
        const failing = checkResult('loudness', 'fail', { fixes: [autoFix('renormaliseAudio')] }, 0);
        const qaReport = report([failing], { renderId });
        await store.update(renderId, {
          status: 'needsAttention',
          qaReport,
          qa: {
            verdict: 'needsAttention',
            round: 1,
            passed: 0,
            warned: 0,
            failed: 1,
            fixed: 0,
            failing: ['loudness'],
          },
        });
        return ok({ renderId, status: 'needsAttention', qa: null } as never);
      },
    };
    const module = renderToolModule({ store, timelines, settings, jobs });
    const tool = (name: string) => module.tools.find((candidate) => candidate.name === name)!;
    const dispatcher = (name: string) => async (payload: unknown) => {
      const receipt = await bus.dispatch(name, payload, AGENT);
      return receipt.ok ? ok(receipt.value.result) : receipt;
    };
    return { timeline, store, tool, runs, dispatcher };
  }

  it('asks with the export card, pre-filled from the export settings', async () => {
    const { timeline, tool, dispatcher } = setup();
    const { ctx } = context(dispatcher('render.setExportPreset'));
    unwrap(
      await tool('render.setExportPreset').run({ projectId: timeline.projectId, presetId: 'reels' }, ctx),
    );
    const card = unwrap(
      await tool('render.export').approvalCard!(
        { projectId: timeline.projectId, timelineId: timeline.id, timelineRevision: timeline.revision },
        {
          runId: newId<'AgentRun'>(),
          toolCallId: newId<'ToolRun'>(),
          projectId: timeline.projectId,
          signal: ctx.signal,
          approvalId: 'a1',
        },
      ),
    );
    expect(parseCard(card).ok).toBe(true);
    expect(card).toMatchObject({
      type: 'exportApproval',
      approvalId: 'a1',
      presetId: 'reels',
      presets: [
        'shorts',
        'reels',
        'tiktok',
        'device',
        'deviceHevc',
        'landscape',
        'standard',
        'square',
        'portrait',
        'square2160',
        'portrait2160',
        'master4k',
        'landscape4k',
      ],
      timelineRevision: timeline.revision,
      music: 'platformSound',
      draft: null,
      status: 'pending',
    });
  });

  it('dispatches with the settings, follows the job, and returns the render with its failing checks', async () => {
    const { timeline, store, tool, runs, dispatcher } = setup();
    const { ctx, stored, progress } = context(dispatcher('render.export'));
    const output = unwrap(
      await tool('render.export').run(
        { projectId: timeline.projectId, timelineId: timeline.id, timelineRevision: timeline.revision },
        ctx,
      ),
    ) as {
      render: { id: string; status: string; presetId: string };
      failing: { id: string }[];
      report: ArtifactRef | null;
    };
    expect(output.render).toMatchObject({ status: 'needsAttention', presetId: 'device' });
    expect(output.render).not.toHaveProperty('filePath');
    expect(output.failing.map((check) => check.id)).toEqual(['loudness']);
    expect(output.report?.mediaType).toBe('application/json');
    expect(stored).toHaveLength(1);
    expect(progress).toEqual([0.5]);
    const row = store.records.get(output.render.id as never)!;
    expect(runs).toEqual([
      { kind: 'render.export', input: { renderId: row.id, request: row.request }, key: undefined },
    ]);
    const card = unwrap(
      await tool('render.export').resultCard!(output as never, {
        runId: newId<'AgentRun'>(),
        toolCallId: newId<'ToolRun'>(),
        projectId: timeline.projectId,
        signal: ctx.signal,
      }),
    );
    expect(card && parseCard(card).ok).toBe(true);
    // An export (not a draft) asks the post-export survey once it is ready (P2-X7).
    expect(card).toMatchObject({
      type: 'renderProgress',
      renderId: row.id,
      status: 'needsAttention',
      survey: true,
    });
  });

  it('lists presets with why a long timeline does not fit, and has no report before QA', async () => {
    const long = makeTimeline({ items: [{ frames: 30 * 200 }] });
    const store = memoryRenderStore();
    const module = renderToolModule({ store, timelines: memoryTimelines(long) });
    const tool = (name: string) => module.tools.find((candidate) => candidate.name === name)!;
    const { ctx } = context();
    const presets = unwrap(
      await tool('render.listPresets').run({ projectId: long.projectId, timelineId: long.id }, ctx),
    ) as {
      presets: { id: string; available: boolean; reasonKey?: string }[];
    };
    expect(presets.presets.find((preset) => preset.id === 'shorts')).toMatchObject({
      available: false,
      reasonKey: 'render.unavailable.tooLong',
    });
    expect(presets.presets.find((preset) => preset.id === 'device')?.available).toBe(true);
    const missing = await tool('render.getQaReport').run({ renderId: newId<'Render'>() }, ctx);
    expect(missing.ok ? null : missing.error.code).toBe('core.not_found');
  });
});

describe('timeline.captureFrame, captions and music tools', () => {
  it('stores the frame as a JPEG artifact', async () => {
    const tool = timelineToolModule({ worker }).tools[0]!;
    const { ctx, stored } = context();
    const output = unwrap(
      await tool.run(
        {
          projectId: newId<'Project'>(),
          timelineId: newId<'Timeline'>(),
          frame: 45,
          source: { kind: 'preview' },
          maxDimension: 768,
        },
        ctx,
      ),
    ) as { seconds: number; image: ArtifactRef; textBoxes: unknown[] };
    expect(output.seconds).toBe(1.5);
    expect(output.image).toMatchObject({ mediaType: 'image/jpeg', bytes: 4 });
    expect(stored[0]!.input.summary).toContain('Frame 45');
    expect(output.textBoxes).toHaveLength(1);
  });

  it('dispatch their commands with the input as payload', async () => {
    const seen: unknown[] = [];
    const summary = {
      timelineId: newId<'Timeline'>(),
      revision: 2,
      enabled: true,
      cues: 3,
      language: 'en',
      styleSource: 'user',
    };
    const { ctx } = context(async (payload) => {
      seen.push(payload);
      return ok(summary);
    });
    const ids = { projectId: newId<'Project'>(), timelineId: summary.timelineId };
    const setStyle = captionToolModule().tools.find((tool) => tool.name === 'captions.setStyle')!;
    expect(unwrap(await setStyle.run({ ...ids, style: { anchorY: 0.5 } }, ctx))).toEqual(summary);
    const choose = musicToolModule().tools[0]!;
    expect(unwrap(await choose.run({ ...ids, choice: { path: 'platformSound' } }, ctx))).toEqual({
      path: 'platformSound',
    });
    expect(seen).toEqual([
      { ...ids, style: { anchorY: 0.5 } },
      { ...ids, choice: { path: 'platformSound' } },
    ]);
  });
});
