// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { authoredEditSchema, AUTHORED_PROGRAM_LIMITS } from './authored-program';
import { creationBriefSchema, creationDraftSchema, creationSourceInputSchema } from './creation-types';

export const CREATION_COMMANDS = {
  create: 'creation.create',
  updateBrief: 'creation.updateBrief',
  updateDraft: 'creation.updateDraft',
  addSource: 'creation.addSource',
  removeSource: 'creation.removeSource',
  research: 'creation.research',
  answer: 'creation.answer',
  approve: 'creation.approve',
  produce: 'creation.produce',
  cancel: 'creation.cancel',
  resume: 'creation.resume',
  retry: 'creation.retry',
  editProgram: 'creation.editProgram',
  replaceSource: 'creation.replaceSource',
  setProgramRange: 'creation.setProgramRange',
  restore: 'creation.restore',
} as const;
const project = { projectId: idSchema<'Project'>() };
const revision = { ...project, revision: z.int().positive() };
const edit = { ...project, timelineId: idSchema<'Timeline'>(), revision: z.int().positive() };

export const creationCommandPayloads = {
  [CREATION_COMMANDS.create]: z.object({
    projectId: idSchema<'Project'>().optional(),
    brief: creationBriefSchema,
  }),
  [CREATION_COMMANDS.updateBrief]: z.object({ ...revision, brief: creationBriefSchema }),
  [CREATION_COMMANDS.updateDraft]: z.object({
    ...revision,
    draftRevision: z.int().positive(),
    draft: creationDraftSchema,
  }),
  [CREATION_COMMANDS.addSource]: z.object({ ...revision, source: creationSourceInputSchema }),
  [CREATION_COMMANDS.removeSource]: z.object({ ...revision, sourceId: idSchema<'CreationSource'>() }),
  [CREATION_COMMANDS.research]: z.object(revision),
  [CREATION_COMMANDS.answer]: z.object({
    ...revision,
    draftRevision: z.int().positive(),
    answers: z.array(z.object({ id: z.string(), answer: z.string().max(4000) })).max(20),
  }),
  [CREATION_COMMANDS.approve]: z.object({ ...revision, draftRevision: z.int().positive() }),
  [CREATION_COMMANDS.produce]: z.object(revision),
  [CREATION_COMMANDS.cancel]: z.object(project),
  [CREATION_COMMANDS.resume]: z.object(project),
  [CREATION_COMMANDS.retry]: z.object({ ...project, revision: z.int().positive().optional() }),
  [CREATION_COMMANDS.editProgram]: z.object({ ...edit, edits: z.array(authoredEditSchema).min(1).max(100) }),
  [CREATION_COMMANDS.replaceSource]: z.object({
    ...edit,
    source: z.string().max(AUTHORED_PROGRAM_LIMITS.sourceBytes),
  }),
  [CREATION_COMMANDS.setProgramRange]: z.object({
    ...edit,
    itemId: idSchema<'TimelineItem'>(),
    sourceStart: rationalTimeSchema.refine((time) => time.value >= 0, 'A nonnegative in-point'),
    duration: rationalTimeSchema.refine((time) => time.value > 0, 'A positive duration'),
    start: rationalTimeSchema.refine((time) => time.value >= 0, 'A nonnegative placement'),
  }),
  [CREATION_COMMANDS.restore]: z.object({ ...project, snapshot: z.unknown() }),
};
