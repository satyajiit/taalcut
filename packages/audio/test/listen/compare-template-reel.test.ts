// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G1: `audio.compare` holds a sound against a template's reference reel. A source may be `{ templateId }`
 * (exactly one of assetId, artifactId and templateId); the reel's file comes from the injected `templateReel` (the
 * desktop's template media store) and goes to the jobs process like any other sound, named for results without a
 * path. A template that keeps no reel with sound, or a process without templates, is refused with a clear error.
 * `audio.listen` and `audio.critique` keep their sources as they were.
 */
import {
  err,
  newId,
  NotFoundError,
  ok,
  type ArtifactStore,
  type AssetId,
  type JobRunner,
  type TemplateId,
  type ToolContextBase,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { critiqueInputSchema } from '../../src/tools/critique-tool';
import {
  compareInputSchema,
  compareOutputSchema,
  listenInputSchema,
  listenTools,
} from '../../src/tools/listen-tools';
import type { ListenQaToolDeps } from '../../src/tools/listen-tool-sources';

const artifacts: ArtifactStore = {
  put: async () => err(NotFoundError({ entity: 'artifact' })),
  get: async (id) => err(NotFoundError({ entity: 'artifact', id })),
};
const context = (): ToolContextBase => ({
  signal: new AbortController().signal,
  callId: newId<'ToolRun'>(),
  attempt: 1,
  artifacts,
  reportUsage: () => undefined,
  reportProgress: () => undefined,
});

const assetId = newId<'Asset'>();
const templateId = newId<'Template'>();
const REEL = '/app/templates/media/reel/reference.mp4';
const assets = { original: async (id: AssetId) => ok({ path: `/library/${id}.wav`, size: 10, mtimeMs: 1 }) };

function compareWith(templateReel?: ListenQaToolDeps['templateReel']) {
  const calls: { kind: string; input: Record<string, unknown> }[] = [];
  const asked: TemplateId[] = [];
  const jobs: Pick<JobRunner, 'run'> = {
    run: (async (kind: { kind: string }, input: Record<string, unknown>) => {
      calls.push({ kind: kind.kind, input });
      if (input['op'] === 'ab')
        return ok({
          op: 'ab',
          result: {
            cosineAb: 0.71,
            likeness: 'related',
            differences: { keys: ['brightness_hz'], words: 'darker' },
            features: [{}, {}],
          },
        });
      return ok({
        op: 'compare',
        result: { nearest: [{ index: 0, cosine: 0.8 }], typicality: { z: 0.4, fit: 'typical of the set' } },
      });
    }) as unknown as JobRunner['run'],
  };
  const deps: ListenQaToolDeps = {
    jobs,
    assets,
    scratch: '/tmp/unused',
    ...(templateReel
      ? {
          templateReel: (id: TemplateId) => {
            asked.push(id);
            return templateReel(id);
          },
        }
      : {}),
  };
  const compare = listenTools(deps).find((tool) => tool.name === 'audio.compare');
  if (!compare) throw new Error('no audio.compare');
  return { compare, calls, asked };
}

describe('audio.compare against the template’s reel (EAR1-G1)', () => {
  it('takes { templateId } as a, b or a reference, exactly one id a sound; listen and critique don’t', () => {
    for (const input of [
      { a: { assetId }, b: { templateId } },
      { a: { templateId }, b: { assetId } },
      { a: { assetId }, refs: [{ templateId }, { assetId }] },
      { a: { assetId }, b: { templateId, range: undefined } },
    ])
      expect(compareInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(true);
    for (const input of [
      { a: { assetId }, b: { templateId, assetId } },
      { a: { assetId }, b: { templateId: 'not-an-id' } },
      { a: {}, b: { templateId } },
    ])
      expect(compareInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    expect(listenInputSchema.safeParse({ sources: [{ templateId }] }).success).toBe(false);
    expect(critiqueInputSchema.safeParse({ source: { templateId } }).success).toBe(false);
    const listen = JSON.stringify(z.toJSONSchema(listenInputSchema, { io: 'input' }));
    expect(listen).not.toContain('templateId');
    expect(JSON.stringify(z.toJSONSchema(compareInputSchema, { io: 'input' }))).toContain('templateId');
  });

  it('sends the reel the template keeps to the jobs process, as B of an A/B', async () => {
    const { compare, calls, asked } = compareWith(async () => ok(REEL));
    const out = await compare.run({ a: { assetId }, b: { templateId } }, context());
    if (!out.ok) throw new Error(out.error.code);
    expect(asked).toEqual([templateId]);
    expect(calls).toHaveLength(1);
    const sources = calls[0]?.input['sources'] as { path: string; name: string }[];
    expect(sources.map((source) => source.path)).toEqual([`/library/${assetId}.wav`, REEL]);
    expect(sources[1]?.name).toBe(`2: template ${templateId}'s reel`);
    expect(compareOutputSchema.parse(out.value)).toMatchObject({
      ab: { cosine: 0.71, differences: ['brightness_hz'] },
    });
  });

  it('names the reel among the references without its path', async () => {
    const { compare } = compareWith(async () => ok(REEL));
    const out = await compare.run({ a: { assetId }, refs: [{ templateId }, { assetId }] }, context());
    if (!out.ok) throw new Error(out.error.code);
    expect(compareOutputSchema.parse(out.value)).toMatchObject({
      nearest: [{ name: `2: template ${templateId}'s reel`, cosine: 0.8 }],
    });
    expect(JSON.stringify(out.value)).not.toContain(REEL);
  });

  it('refuses a template without a reel with sound, and a process without templates', async () => {
    const none = compareWith(async () => ok(null));
    const silent = await none.compare.run({ a: { assetId }, b: { templateId } }, context());
    expect(silent.ok).toBe(false);
    if (!silent.ok) {
      expect(silent.error.code).toBe('audio.listen_bad_input');
      expect(silent.error.detail).toContain('keeps no reel with sound');
    }
    expect(none.calls).toEqual([]);

    const gone = NotFoundError({ entity: 'template', id: templateId });
    const missing = compareWith(async () => err(gone));
    expect(await missing.compare.run({ a: { assetId }, b: { templateId } }, context())).toEqual(err(gone));

    const bare = compareWith();
    const refused = await bare.compare.run({ a: { assetId }, b: { templateId } }, context());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatchObject({ code: 'audio.listen_unavailable' });
    expect(bare.calls).toEqual([]);
  });
});
