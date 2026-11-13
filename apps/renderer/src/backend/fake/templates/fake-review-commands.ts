// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-REV: the review's commands in the renderer's fake (core's TEMPLATE_COMMANDS, BRK1 §2): moving and adding a
 * cut, a slot's role, a typed description (template.slot.editIntent), removing text, halving or doubling the tempo,
 * leaving a doubt as it is, the reel's sound credit, (FRM1-MOT) a slot's camera move, and (DSG1-READ) a graphic's
 * brief and Not a graphic. Each runs through the fake's `edit` (one new version, template.setHead back as its
 * inverse, core.conflict on a stale base) with core's payloads and error codes, so the page sees what main answers.
 */
import {
  defineCommand,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  type AnyCommand,
  type CommandSource,
  type Id,
  type Template,
} from '@taalcut/core';
import type { SlotEditResult } from './template-edits';
import {
  dismissDoubt,
  editIntent,
  moveCut,
  removeText,
  setMotion,
  setRole,
  setSoundCredit,
  setTempo,
  splitSlot,
} from './template-review-edits';
import { editGraphic, setGraphic } from './fake-graphic-briefs';

type Edit = (
  payload: { templateId: Id<'Template'>; baseVersion: number; projectId: Id<'Project'> | null },
  source: CommandSource,
  name: string,
  apply: (template: Template, now: number) => SlotEditResult,
) => ReturnType<AnyCommand['handle']>;

export function reviewCommands(edit: Edit): AnyCommand[] {
  const N = TEMPLATE_COMMANDS;
  const P = templateCommandPayloads;
  return [
    defineCommand({
      name: N.moveCut,
      payload: P[N.moveCut],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) => edit(p, ctx.source, N.moveCut, (t, now) => moveCut(t, p.slotId, p.to, p.snap, now)),
    }),
    defineCommand({
      name: N.splitSlot,
      payload: P[N.splitSlot],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, N.splitSlot, (t, now) => splitSlot(t, p.slotId, p.at, p.snap, now)),
    }),
    defineCommand({
      name: N.setRole,
      payload: P[N.setRole],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) => edit(p, ctx.source, N.setRole, (t, now) => setRole(t, p.slotId, p.role, now)),
    }),
    defineCommand({
      name: N.editIntent,
      payload: P[N.editIntent],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, N.editIntent, (t, now) => editIntent(t, p.slotId, p.intent, ctx.source, now)),
    }),
    defineCommand({
      name: N.removeText,
      payload: P[N.removeText],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) => edit(p, ctx.source, N.removeText, (t, now) => removeText(t, p.overlayIds, now)),
    }),
    defineCommand({
      name: N.setTempo,
      payload: P[N.setTempo],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) => edit(p, ctx.source, N.setTempo, (t, now) => setTempo(t, p.factor, now)),
    }),
    defineCommand({
      name: N.dismissDoubt,
      payload: P[N.dismissDoubt],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, N.dismissDoubt, (t, now) => dismissDoubt(t, p.target, p.reason, now)),
    }),
    defineCommand({
      name: N.setSoundCredit,
      payload: P[N.setSoundCredit],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) => edit(p, ctx.source, N.setSoundCredit, (t, now) => setSoundCredit(t, p.credit, now)),
    }),
    defineCommand({
      name: N.setMotion,
      payload: P[N.setMotion],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) => edit(p, ctx.source, N.setMotion, (t, now) => setMotion(t, p.slotId, p.motion, now)),
    }),
    // DSG1-READ: Not a graphic, its restore, and a brief's words.
    defineCommand({
      name: N.setGraphic,
      payload: P[N.setGraphic],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, N.setGraphic, (t, now) => setGraphic(t, p.overlayId, p.graphic, now)),
    }),
    defineCommand({
      name: N.editGraphic,
      payload: P[N.editGraphic],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, N.editGraphic, (t, now) => editGraphic(t, p.overlayId, p.brief, now)),
    }),
  ];
}
