// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The design eval's stand-in Designer (HFW1 dsn): no model, a script that walks a job the way the Designer's
 * prompt says, with a fixture design (src/fixtures/design/), so the eval runs end to end on any machine: read the
 * brief, start a composition (a new graphic), write the fixture with the job's words, lint, render over the
 * footage, place or replace, answer the comment, hand off. It reads what each call returned from the tool's words.
 * It measures the tools and the eval, never design quality.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import type { DesignerInput, DesignerMessage, DesignerModel } from '@taalcut/render';
import type { DesignCase } from './cases';
import { FIXTURES } from './world';

/** Which fixture stands in for a request, and the variable its words go in. */
function fixtureFor(request: string): { file: string; folder: string; words: string } {
  if (/bubble|text|reply|message|stars/i.test(request)) return { file: 'bubble.html', folder: 'bubble', words: 'message' };
  if (/name|lower third|title,/i.test(request)) return { file: 'lower-third.html', folder: 'lowerthird', words: 'name' };
  return { file: 'headline.html', folder: 'headline', words: 'title' };
}

/** The words a request quotes or names, for the fixture's words variable. */
function wordsOf(entry: DesignCase): string {
  return entry.words[0] ? entry.request.slice(0, 120) : 'Made-up words';
}

const lastOutput = (messages: readonly DesignerMessage[]): Record<string, unknown> => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'tool') continue;
    const text = message.content.find((part) => part.type === 'text');
    try {
      return text && text.type === 'text' ? (JSON.parse(text.text) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
};

export function standInDesigner(entry: DesignCase, input: DesignerInput, entryPath?: string): DesignerModel {
  const job = input.jobs[0]!;
  const { projectId, timelineId } = input;
  const pick = fixtureFor(entry.before?.fixture === 'bubble.html' ? 'bubble' : entry.request);
  const path = entryPath ?? `${pick.folder}/index.html`;
  const redesign = Boolean(job.itemIds);
  let step = 0;
  let placed: Record<string, unknown> = {};
  let revision = 0;
  return {
    seesImages: false,
    async turn(request) {
      step++;
      const said = lastOutput(request.messages);
      // The brief names the timeline's revision.
      const brief = /at revision (\d+)/.exec(typeof said.text === 'string' ? said.text : '');
      if (brief) revision = Number(brief[1]);
      const call = (name: string, args: Record<string, unknown>) =>
        ok({ text: '', calls: [{ id: `s${step}`, name, arguments: args }], model: 'stand-in/designer', local: true });
      const plan: (() => ReturnType<typeof call> | Promise<ReturnType<typeof call>>)[] = [
        () => call('workspace.read', { projectId, timelineId }),
        () => (redesign ? call('workspace.list', { projectId }) : call('workspace.new', { projectId, name: pick.folder, seconds: 3 })),
        async () => {
          let text = await readFile(join(FIXTURES, entry.before?.fixture ?? pick.file), 'utf8');
          // A redesign changes the look a little, so it is a new version.
          if (redesign) text = text.replace('</style>', '  #root { filter: saturate(1.1); }\n    </style>');
          return call('workspace.write', { projectId, path, text });
        },
        () => call('workspace.lint', { projectId, entry: path }),
        () =>
          call('workspace.renderOver', {
            projectId,
            entry: path,
            seconds: [0.5, 1.5, 2.5],
            over: 'footage',
            timelineId,
            at: job.at ?? entry.before?.at ?? 1,
            ...(job.itemIds ? { leaveOut: job.itemIds } : {}),
          }),
        () =>
          redesign
            ? call('workspace.replace', { projectId, timelineId, revision, entry: path, itemIds: job.itemIds })
            : call('workspace.place', {
                projectId,
                timelineId,
                revision,
                entry: path,
                name: entry.id,
                request: job.request,
                ...(job.at !== undefined ? { at: job.at } : {}),
                ...(job.phrase ? { phrase: job.phrase } : {}),
                params: { [pick.words]: wordsOf(entry) },
              }),
        () => {
          placed = said;
          return job.commentId
            ? call('comments.reply', { commentId: job.commentId, reply: 'Made the change you asked for.', status: 'resolved' })
            : call('graphics.list', { timelineId });
        },
        () =>
          call('handOff', {
            timelineId,
            revision: placed.revision,
            results: [
              {
                jobId: job.jobId,
                outcome: redesign ? 'replaced' : 'placed',
                itemIds: redesign ? job.itemIds : placed.itemIds,
                compositionId: placed.compositionId,
              },
            ],
          }),
      ];
      const next = plan[step - 1];
      return next ? next() : ok({ text: 'Done.', calls: [], model: 'stand-in/designer', local: true });
    },
  };
}
