// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: vision.describeFrame reads an image artifact by imageId (a frame video.compare, captureFrame or frameAt
 * kept), sent as it is with nothing extracted; one of path or imageId, never both.
 */
import { newId } from '@taalcut/core';
import {
  describeFrameInputSchema,
  describeFrameOutputSchema,
  visionToolModule,
  type VisionDeps,
} from '@taalcut/vision';
import { describe, expect, it } from 'vitest';
import {
  fakeJobs,
  GEMINI,
  mutableSelector,
  OLLAMA_VL,
  scriptedClient,
  testRuntime,
  testToolContext,
} from './helpers/fakes';

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function setup() {
  const jobs = fakeJobs();
  const models = scriptedClient(() => [
    { choice: GEMINI, local: false, outcome: { text: 'A made-up frame.', costUsd: 0.0004 } },
  ]);
  const deps: VisionDeps = {
    jobs,
    models,
    selector: mutableSelector([OLLAMA_VL, GEMINI]),
    runtime: testRuntime(),
  };
  return { tool: visionToolModule(deps).tools[0]!, jobs, models };
}

describe('describeFrame by imageId', () => {
  it('sends the artifact’s image as it is, at 0, extracting nothing', async () => {
    const { tool, jobs, models } = setup();
    const ctx = testToolContext();
    const put = await ctx.artifacts.put({ mediaType: 'image/png', data: PNG, summary: 'a frame' });
    if (!put.ok) throw new Error(put.error.code);
    const input = { imageId: put.value.id, at: { value: 9, rate: 1 }, detail: 'normal' as const };
    const result = await tool.run(describeFrameInputSchema.parse(input), ctx);
    if (!result.ok) throw new Error(result.error.code);
    const output = describeFrameOutputSchema.parse(result.value);
    expect(output).toMatchObject({
      description: 'A made-up frame.',
      at: { value: 0, rate: 1 },
      frame: { width: 1, height: 1 },
    });
    expect(jobs.calls).toEqual([]);
    const first = models.requests[0]?.messages[0];
    const image = first && 'content' in first ? first.content : undefined;
    expect(Array.isArray(image) && image.find((part) => part.type === 'image')).toMatchObject({
      data: PNG.toString('base64'),
      mimeType: 'image/png',
    });
    expect(tool.idempotencyKey?.(input as never)).toContain(`artifact:${put.value.id}`);
    expect(tool.describeCall?.(input as never, undefined)).toBeUndefined();
  });

  it('refuses an artifact that is not an image, and one it can’t find', async () => {
    const { tool } = setup();
    const ctx = testToolContext();
    const put = await ctx.artifacts.put({ mediaType: 'application/json', data: '{}', summary: 'json' });
    if (!put.ok) throw new Error(put.error.code);
    const notImage = await tool.run(
      describeFrameInputSchema.parse({ imageId: put.value.id, at: { value: 0, rate: 1 } }),
      ctx,
    );
    expect(notImage.ok ? null : notImage.error.code).toBe('core.validation');
    const missing = await tool.run(
      describeFrameInputSchema.parse({ imageId: newId<'Artifact'>(), at: { value: 0, rate: 1 } }),
      ctx,
    );
    expect(missing.ok ? null : missing.error.code).toBe('core.not_found');
  });

  it('takes path or imageId, one of them', () => {
    const at = { value: 0, rate: 1 };
    expect(describeFrameInputSchema.safeParse({ at }).success).toBe(false);
    expect(
      describeFrameInputSchema.safeParse({ path: '/a.jpg', imageId: newId<'Artifact'>(), at }).success,
    ).toBe(false);
    expect(describeFrameInputSchema.safeParse({ path: '/a.jpg', at }).success).toBe(true);
  });
});
