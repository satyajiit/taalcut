// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `images.generateForSlot`: full tool metadata; every take stored through the GeneratedAssetSink with its
 * provenance (the prompt's hash, never the prompt); a gap filled with the first take through
 * `timeline.fillGap`; a clip kept; the imageTakes card; the estimate before paying.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cardSchema,
  ConflictError,
  DEFAULT_MIX,
  err,
  FrameRates,
  newId,
  ok,
  RationalTime,
  TimeRange,
  timelineSchema,
  toolModuleProblems,
  type ArtifactInput,
  type GeneratedFile,
  type ProjectId,
  type SlotId,
} from '@taalcut/core';
import {
  createGenerateForSlotTool,
  createImageProviders,
  createMemoryCloudCallSink,
  disableNetwork,
  imageToolModule,
  type CredentialProvider,
  type ImageToolDeps,
  type NetworkGuard,
} from '@taalcut/models';
import { fixtureBody, GROK, json, keys, selectorOf, signIns, URLS, wire } from './support/image-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

const fps30 = FrameRates.fps30;
const at = (frames: number) => RationalTime.of(frames, fps30);

function timelineWith(projectId: ProjectId, clipSlot: SlotId, gapSlot: SlotId, locked = false) {
  const clipId = newId<'TimelineItem'>();
  const gapId = newId<'TimelineItem'>();
  const doc = {
    schemaVersion: 2,
    id: newId<'Timeline'>(),
    projectId,
    name: 'Goa',
    revision: 3,
    canvas: { width: 1080, height: 1920, rate: fps30 },
    template: null,
    beatMap: null,
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'Video',
        enabled: true,
        items: [
          {
            type: 'clip',
            id: clipId,
            media: {
              kind: 'video',
              assetId: newId<'Asset'>(),
              shotId: newId<'Shot'>(),
              available: TimeRange.of(at(0), at(300)),
            },
            sourceStart: at(0),
            duration: at(60),
            speed: null,
            slotId: clipSlot,
            syncPoint: null,
            beatAnchor: null,
            fit: 'cover',
            audio: { gainDb: 0, muted: false },
            locked,
            enabled: true,
            stillMotion: null,
            reframe: null,
          },
          { type: 'gap', id: gapId, duration: at(45), slotId: gapSlot },
        ],
      },
    ],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  };
  const stored: unknown = JSON.parse(JSON.stringify(doc));
  return { doc: stored, clipId, gapId, timelineId: doc.id };
}

function setup(options: { locked?: boolean; placeFails?: boolean; credentials?: CredentialProvider } = {}) {
  const projectId = newId<'Project'>();
  const clipSlot = newId<'TemplateSlot'>();
  const gapSlot = newId<'TemplateSlot'>();
  const timeline = timelineWith(projectId, clipSlot, gapSlot, options.locked);
  const net = wire({
    [URLS.openrouter]: (sent) => json(fixtureBody('openrouter-grok', Number(sent.body.n))),
    [URLS.xai]: (sent) => json(fixtureBody('xai-grok', Number(sent.body.n))),
  });
  const callLog = createMemoryCloudCallSink();
  const stored: GeneratedFile[] = [];
  const providers = createImageProviders({
    credentials: options.credentials ?? keys('openrouter'),
    callLog,
    localOnly: () => false,
    fetch: net.fetch,
  });
  const deps: ImageToolDeps = {
    providers,
    selector: selectorOf(GROK),
    sink: {
      async put(file) {
        stored.push(file);
        return ok({ assetId: newId<'Asset'>(), contentHash: 'h'.repeat(64), duplicate: false });
      },
    },
    timelines: {
      get: async () =>
        ok({
          summary: {
            id: timeline.timelineId,
            projectId,
            name: 'Goa',
            revision: 3,
            duration: at(105),
            clipCount: 1,
            template: null,
            castId: null,
            variantIndex: null,
            updatedAt: 1,
          },
          schemaVersion: 2,
          json: timeline.doc,
        }),
    },
    now: () => 42,
  };
  const module = imageToolModule(deps);
  const tool = createGenerateForSlotTool(deps);
  const dispatched: unknown[] = [];
  const artifacts: ArtifactInput[] = [];
  const usage: unknown[] = [];
  const runId = newId<'AgentRun'>();
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId,
    attempt: 1,
    artifacts: {
      async put(artifact: ArtifactInput) {
        artifacts.push(artifact);
        return ok({
          id: newId<'Artifact'>(),
          mediaType: artifact.mediaType,
          bytes: 1,
          summary: artifact.summary,
        });
      },
      get: async () => {
        throw new Error('not read');
      },
    },
    reportUsage: (u: unknown) => usage.push(u),
    reportProgress: () => {},
    dispatch: async (payload: unknown) => {
      dispatched.push(payload);
      return options.placeFails
        ? err(ConflictError({ entity: 'timeline' }, { detail: 'revision is 4' }))
        : ok({});
    },
  };
  return {
    tool,
    module,
    ctx,
    projectId,
    clipSlot,
    gapSlot,
    timeline,
    stored,
    dispatched,
    artifacts,
    usage,
    net,
    callLog,
  };
}

describe('images.generateForSlot', () => {
  it('pins a subscription estimate when the account is removed before run', async () => {
    let signedIn = true;
    const plan = signIns('xai');
    const api = keys('openrouter');
    const credentials: CredentialProvider = {
      get: (id, request) => (signedIn && id === 'xai' ? plan : api).get(id, request),
    };
    const s = setup({ credentials });
    const input = s.tool.input.parse({
      projectId: s.projectId,
      timelineId: s.timeline.timelineId,
      slotId: s.gapSlot,
      prompt: 'Airport sunset',
    });
    const estimate = await s.tool.refineCost!(input, { signal: s.ctx.signal });
    expect(estimate.ok && estimate.value.billing).toBe('subscription');
    if (!estimate.ok) return;
    signedIn = false;
    const result = await s.tool.run(input, { ...s.ctx, estimate: estimate.value });
    expect(!result.ok && result.error.code).toBe('models.image_access_denied');
    expect(s.net.sent).toEqual([]);
    expect(s.stored).toEqual([]);
  });

  it('declares its metadata and passes core’s tool checks', () => {
    const { module, tool } = setup();
    expect(toolModuleProblems(module)).toEqual([]);
    expect(tool).toMatchObject({
      name: 'images.generateForSlot',
      version: '1.1.0',
      costClass: 'paid',
      sideEffect: 'write',
      command: 'timeline.fillGap',
      timeoutMs: 120_000,
      retry: { maxAttempts: 1 },
      permission: { network: 'internet', cloudModules: ['images'] },
    });
    expect(
      tool.description.startsWith('Generates a still for one slot from a prompt and places it there'),
    ).toBe(true);
  });

  it('fills a gap with the first take, keeps every take with its provenance, and shows the takes card', async () => {
    const s = setup();
    const input = s.tool.input.parse({
      projectId: s.projectId,
      timelineId: s.timeline.timelineId,
      slotId: s.gapSlot,
      prompt: 'Palm trees at dusk, warm light',
      count: 2,
    });
    const result = await s.tool.run(input, s.ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = s.tool.output.parse(result.value);
    expect(output.assets).toHaveLength(2);
    expect(output.placed).toBe(output.assets[0]?.assetId);
    // OpenRouter's usage.cost for the request (the fixture's) is what was billed.
    expect(output.costUsd).toBe(0.08);
    expect(s.dispatched).toEqual([
      {
        projectId: s.projectId,
        timelineId: s.timeline.timelineId,
        gapId: s.timeline.gapId,
        media: { kind: 'image', assetId: output.assets[0]?.assetId, stillMotion: 'pushIn' },
      },
    ]);
    // The canvas is 9:16, so the request asked for it.
    expect(s.net.sent[0]?.body).toMatchObject({ aspect_ratio: '9:16', n: 2 });
    expect(s.stored.map((f) => [f.fileName.endsWith('.png'), f.projectId, f.provenance.kind])).toEqual([
      [true, s.projectId, 'generated'],
      [true, s.projectId, 'generated'],
    ]);
    const provenance = s.stored[0]?.provenance;
    expect(provenance).toMatchObject({
      generation: 'image',
      provider: 'openrouter',
      model: 'x-ai/grok-imagine-image-2.0',
      access: 'openrouter',
      c2pa: 'unknown',
      runId: s.ctx.runId,
      createdAt: 42,
    });
    expect(JSON.stringify(s.stored.map((f) => f.provenance))).not.toContain('Palm trees');
    expect(s.artifacts).toHaveLength(2);
    expect(s.usage).toEqual([
      { usd: output.costUsd, provider: 'openrouter', model: 'x-ai/grok-imagine-image-2.0' },
    ]);
    expect(s.callLog.records[0]).toMatchObject({
      module: 'images',
      spanId: s.ctx.callId,
      projectId: s.projectId,
    });

    const card = await s.tool.resultCard?.(output, {
      runId: s.ctx.runId,
      toolCallId: s.ctx.callId,
      projectId: s.projectId,
      signal: s.ctx.signal,
    });
    expect(card?.ok && cardSchema.safeParse(card.value).success).toBe(true);
    expect(card?.ok && card.value).toMatchObject({
      type: 'imageTakes',
      placed: output.placed,
      takes: [{}, {}],
    });
  });

  it('keeps a clip in its slot: the takes are stored and nothing is dispatched', async () => {
    for (const locked of [false, true]) {
      const s = setup({ locked });
      const input = s.tool.input.parse({
        projectId: s.projectId,
        timelineId: s.timeline.timelineId,
        slotId: s.clipSlot,
        prompt: 'A cup of chai on a train window',
      });
      const result = await s.tool.run(input, s.ctx);
      expect(result.ok && result.value).toMatchObject({
        placed: null,
        notPlaced: locked ? 'lockedClip' : 'clip',
      });
      expect(s.dispatched).toEqual([]);
      expect(s.stored).toHaveLength(1);
    }
  });

  it('a slot that is not on the timeline is core.not_found, before anything is paid', async () => {
    const s = setup();
    const input = s.tool.input.parse({
      projectId: s.projectId,
      timelineId: s.timeline.timelineId,
      slotId: newId<'TemplateSlot'>(),
      prompt: 'Anything',
    });
    const result = await s.tool.run(input, s.ctx);
    expect(!result.ok && result.error.code).toBe('core.not_found');
    expect(s.net.sent).toEqual([]);
  });

  it('estimates before paying and keys the call on what it would make', () => {
    const s = setup();
    const input = s.tool.input.parse({
      projectId: s.projectId,
      timelineId: s.timeline.timelineId,
      slotId: s.gapSlot,
      prompt: 'Palm trees at dusk',
      count: 3,
    });
    expect(s.tool.estimateCost?.(input).usd).toBeCloseTo(0.24);
    const key = s.tool.idempotencyKey?.(input);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(s.tool.idempotencyKey?.({ ...input, prompt: 'Palm trees at dawn' })).not.toBe(key);
  });

  // Review H2: the stills are paid for and kept before the fill; a fill that fails says which takes are kept, and
  // the charge was reported first, so the executor keeps this error under the call's key.
  it('a fill that fails after paying reports the charge first and names the kept takes', async () => {
    const s = setup({ placeFails: true });
    const input = s.tool.input.parse({
      projectId: s.projectId,
      timelineId: s.timeline.timelineId,
      slotId: s.gapSlot,
      prompt: 'Palm trees at dusk, warm light',
      count: 2,
    });
    const result = await s.tool.run(input, s.ctx);
    expect(!result.ok && result.error.code).toBe('core.conflict');
    expect(s.usage).toEqual([{ usd: 0.08, provider: 'openrouter', model: 'x-ai/grok-imagine-image-2.0' }]);
    expect(s.stored).toHaveLength(2);
    const detail = result.ok ? '' : (result.error.detail ?? '');
    expect(detail).toMatch(/^revision is 4; the 2 paid takes are kept in the library as /);
    expect(detail).toContain("place one, don't generate again");
  });

  it('says what it bills: images, not tokens (review M8)', () => {
    const s = setup();
    const input = s.tool.input.parse({
      projectId: s.projectId,
      timelineId: s.timeline.timelineId,
      slotId: s.gapSlot,
      prompt: 'Palm trees at dusk',
      count: 3,
    });
    expect(s.tool.estimateCost?.(input).billed).toEqual({ unit: 'image', quantity: 3 });
  });

  it('the fixture timeline is a valid Timeline', () => {
    const s = setup();
    expect(timelineSchema.safeParse(s.timeline.doc).success).toBe(true);
  });
});
