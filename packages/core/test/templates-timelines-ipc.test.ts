// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The templates, timelines and acknowledgements namespaces, and their command payloads (P2-T1, P2-M1). */
import { describe, expect, it } from 'vitest';
import {
  acknowledgementsContract,
  acknowledgementsRouter,
  connectRpc,
  err,
  NotFoundError,
  ok,
  REFERENCE_DOWNLOAD_WARNING,
  serveRpc,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  templatesContract,
  templatesRouter,
  templateSummaryFacts,
  NO_TEMPLATE_LIBRARY_META,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelinesContract,
  timelinesRouter,
  type AcknowledgementRecord,
  type AnyContractRouter,
  type RpcClient,
  type RpcRouter,
  type TemplateSummary,
  type Timeline,
} from '@taalcut/core';
import { at, json, ntscTimeline, referenceTemplate, T0 } from './helpers/documents';
import { channel } from './helpers/ports';

function serve<C extends AnyContractRouter>(
  contract: C,
  router: RpcRouter<C, Record<never, never>>,
): RpcClient<C> {
  const { port1, port2 } = channel();
  serveRpc(router, port1, { context: {} });
  return connectRpc(contract, port2, { peer: 'agent' }).client;
}

const template = referenceTemplate();
const summary: TemplateSummary = {
  id: template.id,
  name: 'Goa reel',
  head: 1,
  origin: 'reference',
  platform: 'reels',
  duration: at(90),
  slotCount: 3,
  bpm: 120,
  projectId: null,
  listed: true,
  archived: false,
  ...templateSummaryFacts(template),
  ...NO_TEMPLATE_LIBRARY_META,
  createdAt: T0,
  updatedAt: T0,
};

describe('templates namespace', () => {
  it('lists with defaults, gets a version, lists versions and formats', async () => {
    const queries: unknown[] = [];
    const client = serve(
      templatesContract,
      templatesRouter({
        list: async (query) => (queries.push(query), ok({ items: [summary], nextCursor: null })),
        get: async ({ templateId }) =>
          templateId === template.id ? ok({ summary, template }) : err(NotFoundError({ entity: 'template' })),
        versions: async () =>
          ok([{ version: 1, parentVersion: null, createdAt: T0, command: null, source: null, isHead: true }]),
        formats: async () =>
          ok([
            {
              id: 'vlog',
              version: '1',
              nameKey: 'f.vlog',
              descriptionKey: 'f.vlog.d',
              minSeconds: 15,
              maxSeconds: 90,
              defaultBpm: 120,
              audio: 'music',
              captions: 'optional',
            },
          ]),
      }),
    );
    expect((await client.list({})).items).toHaveLength(1);
    expect(queries).toEqual([{ includeUnlisted: false, includeArchived: false, limit: 50 }]);
    expect(json((await client.get({ templateId: template.id })).template)).toEqual(json(template));
    await expect(
      client.get({ templateId: summary.projectId ?? template.slots[0]!.id }),
    ).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
    expect(await client.versions({ templateId: template.id })).toHaveLength(1);
    expect((await client.formats())[0]?.id).toBe('vlog');
  });
});

describe('timelines namespace', () => {
  it('gets, watches (current first) and finds alternates with defaults', async () => {
    const timeline = ntscTimeline();
    const next: Timeline = { ...timeline, revision: 2 };
    const asked: unknown[] = [];
    const client = serve(
      timelinesContract,
      timelinesRouter({
        listByProject: async () => ok([]),
        get: async () => ok(timeline),
        async *watch() {
          yield timeline;
          yield next;
        },
        findAlternates: async (input) => (asked.push(input), ok([])),
      }),
    );
    expect(await client.listByProject({ projectId: timeline.projectId })).toEqual([]);
    expect((await client.get({ timelineId: timeline.id })).revision).toBe(1);
    const revisions: number[] = [];
    for await (const doc of await client.watch({ timelineId: timeline.id })) revisions.push(doc.revision);
    expect(revisions).toEqual([1, 2]);
    const slotId = timeline.cast!.slots[0]!.slotId;
    await client.findAlternates({ timelineId: timeline.id, slotId });
    expect(asked).toEqual([{ timelineId: timeline.id, slotId, exclude: [], limit: 6 }]);
  });
});

describe('acknowledgements namespace', () => {
  it('records once and answers the first time again', async () => {
    const records = new Map<string, AcknowledgementRecord>();
    let now = T0;
    const client = serve(
      acknowledgementsContract,
      acknowledgementsRouter({
        has: async (featureId, termsVersion) => ok(records.has(`${featureId}@${termsVersion}`)),
        record: async ({ featureId, termsVersion, context }) => {
          const key = `${featureId}@${termsVersion}`;
          const record = records.get(key) ?? { featureId, termsVersion, acknowledgedAt: now++, context };
          records.set(key, record);
          return ok(record);
        },
      }),
    );
    expect(await client.has(REFERENCE_DOWNLOAD_WARNING)).toBe(false);
    expect(await client.record({ ...REFERENCE_DOWNLOAD_WARNING, context: { url: 'https://x' } })).toEqual({
      acknowledgedAt: T0,
    });
    expect(await client.record(REFERENCE_DOWNLOAD_WARNING)).toEqual({ acknowledgedAt: T0 });
    expect(await client.has(REFERENCE_DOWNLOAD_WARNING)).toBe(true);
  });
});

describe('command payloads', () => {
  const where = { projectId: null, templateId: template.id };

  it('template edits name their base version; create takes a valid version 1', () => {
    const approve = templateCommandPayloads[TEMPLATE_COMMANDS.approveSlots];
    expect(approve.parse({ ...where, baseVersion: 1, slotIds: [template.slots[0]!.id] }).approved).toBe(true);
    expect(approve.safeParse({ ...where, slotIds: [template.slots[0]!.id] }).success).toBe(false);
    const intent = templateCommandPayloads[TEMPLATE_COMMANDS.editIntent];
    expect(
      intent.safeParse({ ...where, baseVersion: 1, slotId: template.slots[0]!.id, intent: {} }).success,
    ).toBe(false);
    const create = templateCommandPayloads[TEMPLATE_COMMANDS.create];
    expect(
      create.safeParse({ projectId: null, template: json(template), name: 'Goa', listed: true }).success,
    ).toBe(true);
    const broken = { ...template, slots: [] };
    expect(
      create.safeParse({ projectId: null, template: json(broken), name: 'Goa', listed: true }).success,
    ).toBe(false);
    expect(TEMPLATE_COMMANDS.remove).toBe('template.delete');
  });

  it('timeline edits target a clip by item id', () => {
    const timeline = ntscTimeline();
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const clipId = timeline.cast!.slots[0]!.clipId!;
    const swap = timelineCommandPayloads[TIMELINE_COMMANDS.swapClip];
    const media = { assetId: timeline.cast!.slots[0]!.slotId, shotId: null };
    expect(swap.safeParse({ ...target, clipId, media, from: 'alternate' }).success).toBe(true);
    expect(swap.safeParse({ ...target, clipId, media, from: 'nowhere' }).success).toBe(false);
    const parts = {
      intent: 0.8,
      motion: 0.5,
      quality: 0.7,
      subject: 0.6,
      energy: 0.4,
      hook: null,
      rerank: null,
      penalty: 0,
    };
    const scored = { score: 0.71, parts };
    expect(swap.safeParse({ ...target, clipId, media, from: 'search', scored }).success).toBe(true);
    expect(
      swap.safeParse({ ...target, clipId, media, from: 'search', scored: { score: 0.71 } }).success,
    ).toBe(false);
    const trim = timelineCommandPayloads[TIMELINE_COMMANDS.trimClip];
    expect(trim.safeParse({ ...target, clipId, edge: 'end', by: at(-3) }).success).toBe(true);
    const create = timelineCommandPayloads[TIMELINE_COMMANDS.create];
    expect(create.safeParse({ projectId: timeline.projectId, timelines: [json(timeline)] }).success).toBe(
      true,
    );
    const restore = timelineCommandPayloads[TIMELINE_COMMANDS.restore];
    expect(restore.parse({ ...target, cast: null })).toEqual({ ...target, cast: null });
    const moveText = timelineCommandPayloads[TIMELINE_COMMANDS.moveText];
    expect(
      moveText.safeParse({ ...target, itemId: clipId, box: { x: 0.1, y: 0.2, width: 0.8, height: 0.15 } })
        .success,
    ).toBe(true);
  });
});
