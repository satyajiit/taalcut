// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  agentTurnGroup,
  CommandBusToken,
  createContainer,
  FrameRates,
  newId,
  ok,
  RationalTime,
  StyleStoreToken,
  styleSchema,
  TimeRange,
  unwrap,
  type CommandBus,
  type CommandToolContext,
  type GraphicItem,
  type ShortEditPlan,
  type ShortsRequest,
  type ShortsRun,
  type Style,
  type StyleStore,
} from '@taalcut/core';
import type { LibraryDatabase } from '@taalcut/library';
import type { DesignJob } from '@taalcut/render';
import { assembleShort } from '@taalcut/timeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { resolveShortBrand } from '../src/utility/roots/shorts-brand';
import { finishShortGraphics } from '../src/utility/roots/shorts-design';
import { createShortPublishPack } from '../src/utility/roots/shorts-publish-pack';

const mocks = vi.hoisted(() => ({
  designer: vi.fn(),
  complete: vi.fn(),
  timeline: vi.fn(),
  frames: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock('@taalcut/library', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createShortsCache: () => ({
    get: async (key: string) => ({ ok: true, value: mocks.cache.get(key) ?? null }),
    put: async (key: string, value: unknown) => {
      mocks.cache.set(key, value);
      return { ok: true, value: undefined };
    },
  }),
}));
vi.mock('../src/utility/roots/agent-designer', () => ({ templateDesignerOf: () => mocks.designer }));
vi.mock('../src/utility/roots/agent-tool-models', () => ({
  approvedToolModels: () => ({ complete: mocks.complete }),
}));
vi.mock('../src/utility/roots/shorts-source', () => ({ shortsSource: () => ({ frames: mocks.frames }) }));
vi.mock('../src/shared/render-ports', () => ({ renderTimelines: () => ({ get: mocks.timeline }) }));

function setup() {
  const rate = FrameRates.fps30;
  const duration = RationalTime.fromSeconds(60, rate);
  const request: ShortsRequest = {
    projectId: newId<'Project'>(),
    assetId: newId<'Asset'>(),
    duration,
    platforms: ['shorts', 'reels'],
    sourceUrl: 'https://www.youtube.com/watch?v=source123',
  };
  const range = TimeRange.of(RationalTime.zero(rate), duration);
  const plan: ShortEditPlan = {
    candidateId: newId<'ShortCandidate'>(),
    title: 'The bridge moves',
    hook: 'Watch the bridge move',
    speech: [],
    visuals: [{ source: { assetId: request.assetId, range }, start: RationalTime.zero(rate), duration }],
    duration,
    endingDuration: RationalTime.fromSeconds(2, rate),
  };
  const timeline = unwrap(
    assembleShort(
      {
        projectId: request.projectId,
        timelineId: newId<'Timeline'>(),
        name: plan.title,
        rate,
        plan,
        assets: new Map([[request.assetId, { available: range }]]),
        styleId: null,
        now: 1,
      },
      { item: () => newId<'TimelineItem'>() },
    ),
  );
  const ctx: CommandToolContext = {
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    signal: new AbortController().signal,
    artifacts: { put: vi.fn(), get: vi.fn() },
    reportUsage: vi.fn(),
    reportProgress: vi.fn(),
    dispatch: vi.fn(),
  };
  const dispatch = vi.fn(async (name: string, payload: Record<string, unknown>) => {
    if (name === 'graphics.placeComposition') {
      const itemId = newId<'TimelineItem'>();
      const graphic: GraphicItem = {
        type: 'graphic',
        id: itemId,
        anchor: payload.anchor as GraphicItem['anchor'],
        start: (payload.anchor as { at: RationalTime }).at,
        duration: payload.duration as RationalTime,
        placement: 'top',
        styleKey: 'title',
        language: null,
        origin: 'agent',
        proposal: payload.proposal as GraphicItem['proposal'],
        composition: { id: newId<'GraphicComposition'>(), hash: 'a'.repeat(64), params: {} },
      };
      timeline.tracks.push({ id: itemId, kind: 'text', name: 'Graphic', enabled: true, items: [graphic] });
      return ok({ result: { itemId, revision: ++timeline.revision } });
    }
    for (const track of timeline.tracks)
      if (track.kind === 'text')
        for (const item of track.items)
          if (item.type === 'graphic' && item.id === payload.itemId) delete item.proposal;
    return ok({ result: { revision: ++timeline.revision } });
  });
  const container = createContainer()
    .value(LibraryDatabaseToken, {} as LibraryDatabase)
    .value(CommandBusToken, { dispatch } as unknown as CommandBus);
  mocks.timeline.mockResolvedValue(ok(timeline));
  mocks.frames.mockResolvedValue(ok([{ at: range.start, data: 'frame', mimeType: 'image/jpeg' }]));
  mocks.designer.mockImplementation(async (job: DesignJob) =>
    ok({
      designed: {
        composition: { variables: job.brief.variables, gate: { passed: true } },
        params: {},
      },
    }),
  );
  return { container, request, plan, timeline, ctx, dispatch };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
});

describe('shorts finishing integration', () => {
  it('designs and accepts title/ending graphics, grouping commands and reusing them on resume', async () => {
    const s = setup();
    expect((await finishShortGraphics(s.container, s.request, s.plan, s.timeline, null, s.ctx)).ok).toBe(
      true,
    );
    expect(s.dispatch.mock.calls.map(([name]) => name)).toEqual([
      'graphics.placeComposition',
      'graphics.useProposal',
      'graphics.placeComposition',
      'graphics.useProposal',
    ]);
    const options = (s.dispatch.mock.calls[0] as unknown[])[3];
    expect(options).toMatchObject({ group: agentTurnGroup(s.ctx.runId!) });
    const ending = s.dispatch.mock.calls[2]![1];
    expect(RationalTime.toSeconds(ending.duration as RationalTime)).toBe(2);
    expect(RationalTime.toSeconds((ending.anchor as { at: RationalTime }).at)).toBe(58);
    expect(mocks.designer.mock.calls[1]![0].brief.overlays[0].words).toBe('Full video on YouTube');
    expect((await finishShortGraphics(s.container, s.request, s.plan, s.timeline, null, s.ctx)).ok).toBe(
      true,
    );
    expect(mocks.designer).toHaveBeenCalledTimes(2);
    expect(s.dispatch).toHaveBeenCalledTimes(4);
  });

  it('leaves a failed designer result for review without placing a substitute', async () => {
    const s = setup();
    mocks.designer.mockResolvedValue(ok({ reason: 'Text collides with the subject' }));
    const result = await finishShortGraphics(s.container, s.request, s.plan, s.timeline, null, s.ctx);
    expect(result.ok).toBe(false);
    expect(s.dispatch).not.toHaveBeenCalled();
  });

  it.each([3, 2.2])(
    'keeps title and ending apart in a short faithful excerpt of %s seconds',
    async (seconds) => {
      const s = setup();
      const plan = { ...s.plan, duration: RationalTime.fromSeconds(seconds, FrameRates.fps30) };
      expect((await finishShortGraphics(s.container, s.request, plan, s.timeline, null, s.ctx)).ok).toBe(
        true,
      );
      const placements = s.dispatch.mock.calls
        .filter(([name]) => name === 'graphics.placeComposition')
        .map(([, payload]) => payload);
      const ending = placements.at(-1)!;
      const endingStart = RationalTime.toSeconds((ending.anchor as { at: RationalTime }).at);
      if (seconds >= 2.5) {
        expect(placements).toHaveLength(2);
        expect(RationalTime.toSeconds(placements[0]!.duration as RationalTime)).toBeLessThanOrEqual(
          endingStart,
        );
      } else expect(placements).toHaveLength(1);
    },
  );

  it('reuses a saved default brand without another model call', async () => {
    const s = setup();
    const style = { id: newId<'Style'>(), creator: { name: 'Mira', profileLinkConfirmed: false } } as Style;
    s.container.value(StyleStoreToken, {
      list: async () => ok([{ id: style.id, kind: 'brandKit', isDefault: true }]),
      get: async () => ok(style),
    } as unknown as StyleStore);
    const result = await resolveShortBrand(s.container, s.request, s.plan, s.ctx);
    expect(result).toEqual(ok(style));
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(s.dispatch).not.toHaveBeenCalled();
  });

  it('infers the look from source frames, persists it through a grouped command, and only uses verified identity', async () => {
    const s = setup();
    mocks.cache.set(`shorts.sourceMetadata:${s.request.assetId}`, {
      title: 'Episode',
      channel: 'Mira',
      channelUrl: 'https://www.youtube.com/@mira',
      uploaderId: 'unverified-handle',
    });
    const look = {
      colours: {
        primary: '#eebb77',
        secondary: '#223344',
        accent: '#ffaa33',
        text: '#ffffff',
        background: '#101010',
      },
      fonts: { heading: { family: 'poppins', weight: 700 }, body: { family: 'notoSans', weight: 400 } },
    };
    mocks.complete.mockResolvedValue(ok({ status: 'answered', text: JSON.stringify(look), costUsd: 0.02 }));
    let saved: Style | undefined;
    s.container.value(StyleStoreToken, {
      list: async () => ok([]),
      get: async () => ok(saved!),
    } as unknown as StyleStore);
    const dispatch = vi.fn(async (_name: string, payload: { styleId: string; style: object }) => {
      saved = styleSchema.parse({
        ...payload.style,
        id: payload.styleId,
        schemaVersion: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return ok({ result: { styleId: saved.id, revision: 1 } });
    });
    s.container.value(CommandBusToken, { dispatch } as unknown as CommandBus);
    const brand = unwrap(await resolveShortBrand(s.container, s.request, s.plan, s.ctx));
    expect(brand?.colours).toEqual(look.colours);
    expect(brand?.creator).toEqual({
      name: 'Mira',
      youtubeUrl: 'https://www.youtube.com/@mira',
      profileLinkConfirmed: false,
    });
    expect(mocks.frames).toHaveBeenCalledOnce();
    expect(s.ctx.reportUsage).toHaveBeenCalledWith({ usd: 0.02 });
    expect((dispatch.mock.calls[0] as unknown[])[3]).toMatchObject({ group: agentTurnGroup(s.ctx.runId!) });
    const nextCandidate = { ...s.plan, candidateId: newId<'ShortCandidate'>() };
    expect(unwrap(await resolveShortBrand(s.container, s.request, nextCandidate, s.ctx))?.id).toBe(brand?.id);
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('builds the pack from the persisted accepted selection and requires no image call', async () => {
    const s = setup();
    const run: ShortsRun = {
      id: newId<'ShortsRun'>(),
      request: s.request,
      plan: s.plan,
      candidates: [
        {
          id: s.plan.candidateId,
          title: s.plan.title,
          hook: s.plan.hook,
          context: 'An engineer demonstrates expansion.',
          payoff: 'The gap allows movement.',
          reason: 'A complete explanation',
          speech: [],
          visuals: s.plan.visuals.map((span) => span.source),
        },
      ],
      timelineId: s.timeline.id,
      status: 'ready',
      stage: 'ready',
      issues: [],
      createdAt: 1,
      updatedAt: 2,
    };
    const pack = unwrap(await createShortPublishPack(s.container, run));
    expect(pack.thumbnails).toEqual([]);
    expect(pack.social.youtube.title).toBe(s.plan.title);
    expect(pack.social.youtube.description).toContain('The gap allows movement.');
    expect(pack.social.instagram.caption).not.toContain('link in my profile');
    expect(mocks.complete).not.toHaveBeenCalled();
    const coverAssetId = newId<'Asset'>();
    mocks.cache.set(`shorts.cover:${run.id}`, { assetId: coverAssetId });
    expect(unwrap(await createShortPublishPack(s.container, run)).coverAssetId).toBe(coverAssetId);
  });
});
