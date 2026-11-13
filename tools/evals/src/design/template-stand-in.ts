// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template mode's stand-ins (HFW1 tpl): no model and no Chrome, so the mode runs end to end anywhere. The
 * stand-in Designer walks a template job the way the template Designer's prompt says (start a composition, write,
 * lint, render over the reel's frame from just before it comes on, design.done with each overlay's words) and
 * writes the reel's own fixture for the brief's lead overlay (its design fixture, for a reel of another shape). The stand-in draw draws nothing: it says a
 * composition sits where its case says (by its composition id) on that many lines. It measures the tools, the
 * template path and the checks, never design quality.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type ProjectId, type TextOverlay, type WorkspaceStore } from '@taalcut/core';
import type { DesignerMessage, DesignerModel } from '@taalcut/render';
import type { ReelOverlay, TemplateCase } from './template-cases';
import { REEL_FIXTURES } from './template-reel';
import type { FramesFn } from './world';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
/** A picture that draws nothing, for the stand-in's reel. */
export const BLANK_PICTURE = { data: JPEG, mimeType: 'image/jpeg' as const };

/** Stills that draw nothing, each where its case says its composition sits. */
export function standInDraw(
  store: Pick<WorkspaceStore, 'readBlob'>,
  cases: readonly TemplateCase[],
): FramesFn {
  const where = new Map(
    cases.flatMap((entry) =>
      entry.overlays.flatMap((overlay) => [
        [overlay.fixture, overlay.standIn] as const,
        ...(overlay.designFixture && overlay.designStandIn
          ? [[overlay.designFixture, overlay.designStandIn] as const]
          : []),
      ]),
    ),
  );
  return async (input) => {
    const file = input.files.find((candidate) => candidate.path === input.entry);
    const data = file ? await store.readBlob(input.projectId as ProjectId, file.sha256) : null;
    const text = data?.ok ? new TextDecoder().decode(data.value) : '';
    const id = /data-composition-id="([^"]+)"/.exec(text)?.[1];
    const found = id ? where.get(id) : undefined;
    return ok({
      frames: input.seconds.map((seconds) => ({
        seconds,
        mimeType: 'image/jpeg' as const,
        dataBase64: JPEG,
        width: 432,
        height: 768,
        box: found?.box ?? null,
        lines: found?.lines ?? 0,
      })),
      checks: [{ id: 'bounds', status: 'pass' as const }],
      ms: 1,
    });
  };
}

const taskText = (messages: readonly DesignerMessage[]) => {
  const first = messages[0];
  const part = first?.role === 'user' ? first.content.find((entry) => entry.type === 'text') : undefined;
  return part && part.type === 'text' ? part.text : '';
};

/** The stand-in template Designer; `overlays` names each template overlay's case overlay. */
export function templateStandIn(overlays: ReadonlyMap<TextOverlay['id'], ReelOverlay>): DesignerModel {
  let step = 0;
  return {
    seesImages: false,
    async turn(request) {
      // A job's loop starts with the task alone.
      if (request.messages.length === 1) step = 0;
      step++;
      const task = taskText(request.messages);
      const projectId = /^Project (\S+)\./m.exec(task)?.[1] ?? '';
      const ids = [...task.matchAll(/### (?:Lead|Also): overlay (\S+)/g)].map((match) => match[1]!);
      const lead = overlays.get(ids[0] as TextOverlay['id']);
      const before = new RegExp(`overlay ${ids[0]}, before, [\\d.]+ s into the reel: imageId (\\S+)`).exec(
        task,
      )?.[1];
      // A 16:9 reel's graphic is written as designed for the 9:16 canvas, else as the reel's own.
      const name = lead?.designFixture ?? lead?.fixture ?? 'graphic';
      const entry = `${name}/index.html`;
      const call = (tool: string, args: Record<string, unknown>) =>
        ok({
          text: '',
          calls: [{ id: `t${step}`, name: tool, arguments: args }],
          model: 'stand-in/template',
          local: true,
        });
      switch (step) {
        case 1:
          return call('workspace.new', { projectId, name, seconds: 3 });
        case 2:
          return call('workspace.write', {
            projectId,
            path: entry,
            text: await readFile(join(REEL_FIXTURES, `${name}.html`), 'utf8'),
          });
        case 3:
          return call('workspace.lint', { projectId, entry });
        case 4:
          return call('workspace.renderOver', {
            projectId,
            entry,
            seconds: [0.5, 1.4],
            over: 'image',
            imageId: before,
          });
        case 5:
          return call('design.done', {
            entry,
            name,
            params: Object.fromEntries(
              ids.map((id) => [id, { text: overlays.get(id as TextOverlay['id'])?.words ?? '' }]),
            ),
          });
        default:
          return ok({ text: 'Done.', calls: [], model: 'stand-in/template', local: true });
      }
    },
  };
}
