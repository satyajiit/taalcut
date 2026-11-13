// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The template Designer's tests' parts: a fixture design, stills that draw nothing, a scripted model, a job. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type WorkspaceFramesInput } from '@taalcut/core';
import { compositionBriefs } from '../../../src/workspace/template/brief';
import { briefMarkdown } from '../../../src/workspace/template/brief-text';
import type { DesignJob } from '../../../src/workspace/template/designer';
import type { DesignerCall, DesignerMessage, DesignerModel } from '../../../src/workspace/designer/loop';
import { madeUpReel } from '../template/reel-fixture';

export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
export const fixture = () =>
  readFile(join(import.meta.dirname, '..', 'tools', 'fixtures', 'bubble.html'), 'utf8');

export const frames = async (input: WorkspaceFramesInput) =>
  ok({
    frames: input.seconds.map((seconds) => ({
      seconds,
      mimeType: 'image/jpeg' as const,
      dataBase64: JPEG,
      width: 432,
      height: 768,
      // Where the made-up reel's question sits on the canvas, its words raised to the floor (reel-match.ts).
      box: { x: 0.06, y: 0.373, width: 0.57, height: 0.06 },
    })),
    checks: [{ id: 'contrast', status: 'pass' as const }],
    ms: 3,
  });

/** A model that plays its calls in order, one turn each, then says it is done; it keeps what it was shown. */
export function scripted(seesImages: boolean, plays: ((task: string) => DesignerCall)[]) {
  const seen: (readonly DesignerMessage[])[] = [];
  const model: DesignerModel = {
    seesImages,
    turn: async (request) => {
      seen.push(request.messages);
      const first = request.messages[0];
      const task =
        first?.role === 'user'
          ? first.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
          : '';
      const play = plays[seen.length - 1];
      return ok({
        text: play ? '' : 'Done.',
        calls: play ? [play(task)] : [],
        model: 'stand-in/designer',
        local: true,
      });
    },
  };
  return { model, seen };
}

export const call = (name: string, args: Record<string, unknown>): DesignerCall => ({
  id: `c-${name}-${Math.random()}`,
  name,
  arguments: args,
});

export function jobFor(projectId: string): DesignJob {
  const { template, question } = madeUpReel();
  const brief = compositionBriefs(template).find((entry) =>
    entry.overlays.some((o) => o.overlayId === question.id),
  )!;
  return {
    projectId: projectId as DesignJob['projectId'],
    brief,
    markdown: briefMarkdown(brief),
    reel: brief.overlays.map((overlay) => ({
      overlayId: overlay.overlayId,
      moment: 'before' as const,
      seconds: 0.9,
      picture: { data: JPEG, mimeType: 'image/jpeg' as const },
    })),
    feedback: null,
  };
}
