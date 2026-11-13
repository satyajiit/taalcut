// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: timeline.captureFrame's frame goes to the model as a picture only where the person's frames may go. */
import { err, newId, NotImplementedError, ok, type ArtifactRef, type RenderWorker } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { FOOTAGE_KEPT, footageVerdict } from '../../src/eyes/pictures';
import { timelineToolModule } from '../../src/tools/capture-frame-tool';
import { eyesContext, runTool } from './support';

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
      textBoxes: [],
    }),
};

const input = () => ({
  projectId: newId<'Project'>(),
  timelineId: newId<'Timeline'>(),
  frame: 30,
  source: { kind: 'preview' },
});

describe('timeline.captureFrame pictures', () => {
  it('returns the frame as a picture under the person’s consent', async () => {
    const tool = timelineToolModule({
      worker,
      pictures: async () => ({ shown: true, why: 'Under the person’s standing upload consent.' }),
    }).tools[0]!;
    const { ctx } = eyesContext();
    const output = await runTool(tool, input(), ctx);
    if (!output.ok) throw new Error(output.error.code);
    expect(output.value.pictures).toEqual({
      footage: 'shown',
      why: 'Under the person’s standing upload consent.',
    });
    const images = tool.images?.(output.value as never) ?? [];
    expect(images).toEqual([output.value.image as ArtifactRef]);
  });

  it('keeps it on this Mac without consent, or unwired, and says so', async () => {
    for (const pictures of [async () => ({ shown: false, why: 'No standing consent.' }), undefined]) {
      const tool = timelineToolModule({ worker, ...(pictures ? { pictures } : {}) }).tools[0]!;
      const { ctx } = eyesContext();
      const output = await runTool(tool, input(), ctx);
      if (!output.ok) throw new Error(output.error.code);
      expect((output.value.pictures as { footage: string }).footage).toBe('kept');
      expect(tool.images?.(output.value as never)).toEqual([]);
    }
  });

  it('keeps the frames when the rule fails', async () => {
    const verdict = await footageVerdict(async () => {
      throw new Error('settings unreadable');
    });
    expect(verdict).toEqual({ footage: 'kept', why: FOOTAGE_KEPT.why });
  });
});
