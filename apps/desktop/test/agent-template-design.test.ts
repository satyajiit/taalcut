// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: the app's side of a template's graphics: a kept composition's files go from the project's workspace
 * into the templates' pool, and the judge's stills are the render worker's, drawn over the reel's frame.
 */
import { describe, expect, it } from 'vitest';
import { err, newId, NotFoundError, ok, type GraphicComposition, type RenderWorker } from '@taalcut/core';
import { drawOverWith, keepInPool } from '../src/utility/roots/agent-template-design';

const sha = (c: string) => c.repeat(64);
const composition = {
  entry: 'index.html',
  files: [
    { path: 'index.html', sha256: sha('a'), bytes: 3 },
    { path: 'assets/x', sha256: sha('b'), bytes: 3 },
  ],
} as unknown as GraphicComposition;

describe('a template’s graphics in the app (HFW1 tpl)', () => {
  it('copies a kept composition’s files into the templates’ pool, and says when one is missing', async () => {
    const pooled: string[] = [];
    const store = {
      readBlob: async (_project: unknown, sha256: string) =>
        sha256 === sha('a') || sha256 === sha('b')
          ? ok(new TextEncoder().encode(sha256.slice(0, 3)))
          : err(NotFoundError({ entity: 'workspaceBlob', id: sha256 })),
      putTemplateBlob: async (data: Uint8Array) => {
        pooled.push(new TextDecoder().decode(data));
        return ok({ sha256: sha('a'), bytes: data.length });
      },
    };
    const projectId = newId<'Project'>();
    expect((await keepInPool(store, projectId)(composition)).ok).toBe(true);
    expect(pooled).toEqual(['aaa', 'bbb']);
    const missing = { ...composition, files: [{ path: 'index.html', sha256: sha('c'), bytes: 3 }] };
    expect(await keepInPool(store, projectId)(missing as never)).toMatchObject({ ok: false });
    expect(await keepInPool({ readBlob: store.readBlob }, projectId)(composition)).toMatchObject({
      ok: false,
      error: { code: 'core.not_implemented' },
    });
  });

  it('draws the judge’s stills over the reel’s frame with the render worker', async () => {
    const asked: unknown[] = [];
    const worker = {
      workspaceFrames: async (input: { seconds: number[] }) => {
        asked.push(input);
        return ok({
          frames: input.seconds.map((seconds) => ({
            seconds,
            mimeType: 'image/jpeg' as const,
            dataBase64: '/9j/AA==',
            width: 432,
            height: 768,
          })),
          checks: [],
          ms: 3,
        });
      },
    } as unknown as RenderWorker;
    const projectId = newId<'Project'>();
    const drawn = await drawOverWith(
      worker,
      projectId,
    )({
      composition,
      params: { text: 'Made-up words' },
      seconds: [0.07, 1.5],
      over: { data: '/9j/BB==', mimeType: 'image/jpeg' },
    });
    expect(drawn.ok && drawn.value).toEqual([
      { data: '/9j/AA==', mimeType: 'image/jpeg' },
      { data: '/9j/AA==', mimeType: 'image/jpeg' },
    ]);
    expect(asked[0]).toMatchObject({
      projectId,
      entry: 'index.html',
      params: { text: 'Made-up words' },
      over: { kind: 'image', mimeType: 'image/jpeg', dataBase64: '/9j/BB==' },
    });
    expect(await drawOverWith({} as RenderWorker, projectId)({} as never)).toMatchObject({ ok: false });
  });
});
