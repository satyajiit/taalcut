// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type CreationDraft,
  type CreationProject,
} from '@taalcut/core';
import { z } from 'zod';
import { CreationOutputInvalid } from './errors';
import type { CreationScene } from './ports';
import { CREATION_DESIGNER_PROMPT } from './prompts';
import type { CreationTasks } from './tasks';
import { creationMotionOf } from './motion-contract';

const sceneSourceSchema = z
  .object({
    html: z.string().min(1).max(200_000),
    css: z.string().max(100_000),
    animation: z.string().max(100_000),
  })
  .refine(validCreationScene, 'Scene must be deterministic and editable');

/** The full render gate remains authoritative; these catch violations before an expensive preview. */
export function validCreationScene(scene: Pick<CreationScene, 'html' | 'css' | 'animation'>): boolean {
  const markup = (scene.html + scene.css).replace(/\bxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/g, '');
  return (
    !/<(?:script|iframe|object|embed|canvas|video|audio)\b|\bon[a-z]+\s*=/i.test(scene.html) &&
    !/https?:\/\/|javascript:|data:text\/html/i.test(markup) &&
    !/@keyframes|@import/i.test(scene.css) &&
    !/\b(?:fetch|setTimeout|setInterval|requestAnimationFrame|eval|Function|document|window|Date|Math\.random)\b/.test(
      scene.animation,
    ) &&
    !/gsap\.timeline|\.play\s*\(|\.seek\s*\(/.test(scene.animation) &&
    /\bid\s*=/.test(scene.html) &&
    /\bdata-hf-id\s*=/.test(scene.html)
  );
}

export function creationSceneIds(html: string, prefix: string): boolean {
  const ids = [...html.matchAll(/(?:^|[\s<])id\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]!);
  const stable = [...html.matchAll(/\bdata-hf-id\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]!);
  return (
    ids.length > 0 &&
    new Set(ids).size === ids.length &&
    new Set(stable).size === stable.length &&
    ids.every((id) => id.startsWith(`${prefix}-`)) &&
    stable.every((id) => id.startsWith(`${prefix}-`))
  );
}

export async function makeCreationScene(
  tasks: CreationTasks,
  project: CreationProject,
  draft: CreationDraft,
  beat: CreationDraft['beats'][number],
  format: CreationScene['format'],
  preview = false,
  repairNotes: readonly string[] = [],
  attempt = 0,
): AsyncResult<CreationScene> {
  const source = await tasks.model(
    `${preview ? 'look' : 'scene'}:${format}:${beat.id}:${attempt}`,
    'designer',
    draft.revision,
    sceneSourceSchema.refine(
      (value) => creationSceneIds(value.html, beat.id),
      'Every ID must have the beat prefix',
    ),
    CREATION_DESIGNER_PROMPT,
    JSON.stringify({
      brief: project.brief,
      visualDirection: draft.visualDirection,
      answers: draft.questions.filter((question) => question.answer),
      beat,
      beatDurationSeconds: RationalTime.toSeconds(beat.duration),
      beatStartSeconds: draft.beats
        .slice(0, draft.beats.indexOf(beat))
        .reduce((sum, b) => sum + RationalTime.toSeconds(b.duration), 0),
      repairNotes,
      motionContract: creationMotionOf(project, draft.revision),
      logos:
        project.tasks.find((task) => task.key === 'brand:logos' && task.inputRevision === draft.revision)
          ?.artifact ?? null,
      format,
      previousBeat: draft.beats[draft.beats.indexOf(beat) - 1] ?? null,
      nextBeat: draft.beats[draft.beats.indexOf(beat) + 1] ?? null,
      sources: project.sources.map((s) => ({
        id: s.id,
        content: s.content?.slice(0, 8000),
        evidence: s.evidence,
        assetIds: s.assetIds,
      })),
    }),
    project.sources.flatMap((source) => source.assetIds).slice(0, 12),
  );
  if (!source.ok) return source;
  const scene = { beatId: beat.id, format, ...source.value };
  return validCreationScene(scene)
    ? ok(scene)
    : err(
        CreationOutputInvalid(undefined, {
          detail: 'Scene violates the editable, deterministic source contract.',
        }),
      );
}
