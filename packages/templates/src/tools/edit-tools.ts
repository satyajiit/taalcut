// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The slot edits as agent tools (P2-T8). Each wraps its command, so an agent
 * edit gets the same undo entry, audit row and new version as the button in
 * the breakdown card. `baseVersion` is the version the agent read; a newer
 * head is a conflict to re-read, not something to overwrite.
 */
import {
  defineTool,
  NO_TOOL_RETRY,
  ok,
  slotIntentPatchSchema,
  TEMPLATE_COMMANDS,
  type AnyTool,
  type TemplateEditResult,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../store/change-key';
import { templateRefOutputSchema } from './schemas';

const MINUTE = 60_000;
const where = {
  projectId: ulidSchema('Project').nullable(),
  templateId: ulidSchema('Template'),
  baseVersion: z.int().min(1).describe('The version you read (templates.get)'),
};

interface EditToolSpec {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly input: z.ZodObject;
}

function editTool(spec: EditToolSpec): AnyTool {
  return defineTool({
    name: spec.name,
    version: '1.0.0',
    description: spec.description,
    tags: spec.tags,
    input: spec.input,
    output: templateRefOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: spec.command,
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { write: ['library'] } },
    idempotencyKey: (input) => sha256Hex(canonicalJson({ tool: spec.name, input })),
    run: async (input, ctx) => {
      const result = await ctx.dispatch(input);
      if (!result.ok) return result;
      const { templateId, version } = result.value as TemplateEditResult;
      return ok({ templateId, version });
    },
  });
}

export function slotEditTools(): AnyTool[] {
  return [
    editTool({
      name: 'templates.approveSlots',
      command: TEMPLATE_COMMANDS.approveSlots,
      description:
        "Marks slots approved (or not, approved: false). Approved slots are the user's: the agent can't " +
        'change their intent afterwards. Makes a new version.',
      tags: ['template', 'slot', 'approve'],
      input: z.object({
        ...where,
        slotIds: z.array(ulidSchema('TemplateSlot')).min(1).max(200),
        approved: z.boolean().optional(),
      }),
    }),
    editTool({
      name: 'templates.renameSlot',
      command: TEMPLATE_COMMANDS.renameSlot,
      description: 'Names a slot (or clears its name with null). Makes a new version.',
      tags: ['template', 'slot', 'rename'],
      input: z.object({
        ...where,
        slotId: ulidSchema('TemplateSlot'),
        name: z.string().trim().min(1).max(60).nullable(),
      }),
    }),
    editTool({
      name: 'templates.mergeSlots',
      command: TEMPLATE_COMMANDS.mergeSlots,
      description:
        'Merges adjacent slots into one spanning them all; the intent comes from intentFrom (default the ' +
        'first). Makes a new version.',
      tags: ['template', 'slot', 'merge'],
      input: z.object({
        ...where,
        slotIds: z.array(ulidSchema('TemplateSlot')).min(2).max(50),
        intentFrom: ulidSchema('TemplateSlot').optional(),
      }),
    }),
    editTool({
      name: 'templates.dropSlot',
      command: TEMPLATE_COMMANDS.dropSlot,
      description:
        'Drops a slot: the slot before it takes its time (the first slot gives its time to the next). ' +
        "A template's last slot can't be dropped. Makes a new version.",
      tags: ['template', 'slot', 'drop', 'remove'],
      input: z.object({ ...where, slotId: ulidSchema('TemplateSlot') }),
    }),
    editTool({
      name: 'templates.editIntent',
      command: TEMPLATE_COMMANDS.editIntent,
      description:
        "Changes part of a slot's intent (text, shot type, camera motion, subject, people, place, energy). " +
        'Not for approved slots. Makes a new version.',
      tags: ['template', 'slot', 'intent', 'edit'],
      input: z.object({ ...where, slotId: ulidSchema('TemplateSlot'), intent: slotIntentPatchSchema }),
    }),
  ];
}
