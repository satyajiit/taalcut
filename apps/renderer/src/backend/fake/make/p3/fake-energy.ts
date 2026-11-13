// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- core errors' `detail`: for developers, never UI copy */

/**
 * P3-V12: the energy curve's preview (timelines.planEnergyCurve) and its commands, as the real ones answer.
 * timeline.applyEnergyCurve re-splits the version the timeline was made from, rebases the timeline onto it
 * (the plan's picks in the changed slots), stores the re-split as the template's next version (with
 * template.setEnergyCurve's name) and points the timeline at it: one undo step puts both back.
 * template.setEnergyCurve (the template page) makes the next version from the head it names.
 */
import {
  appContract,
  ConflictError,
  defineCommand,
  err,
  implementContract,
  NotFoundError,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelineSchema,
  toRpcError,
  type AnyCommand,
  type CommandContext,
  type ProjectId,
  type Timeline,
} from '@taalcut/core';
import { splitOnCurve } from '../../../../features/timeline/energy/energy-split';
import { timelineError } from '../edits';
import type { MakeP3Deps } from './deps';
import { curveOnTimeline, energySlotIds, planEnergyCurve } from './energy/plan';
import { rebaseOnCurve } from './energy/rebase';

const PROCEDURES = { planEnergyCurve: appContract.timelines.planEnergyCurve };

/**
 * The energy curve's inverse: timeline.restore's payload (with `templateHead`), run by this module because the
 * fake's timeline.restore doesn't move a template's head. Internal: only undo runs it.
 */
export const ENERGY_RESTORE = 'timeline.restoreEnergyCurve';

const RestorePayload = timelineCommandPayloads[TIMELINE_COMMANDS.restore];
type Restore = ReturnType<typeof RestorePayload.parse>;

/** The parts an energy curve changes, as they are in `timeline`. */
const partsOf = (timeline: Timeline) => ({
  tracks: timeline.tracks,
  markers: timeline.markers,
  cast: timeline.cast,
  template: timeline.template,
});

export function createFakeEnergy(deps: MakeP3Deps) {
  const os = implementContract(PROCEDURES);
  const router = {
    planEnergyCurve: os.planEnergyCurve.handler(async ({ input }) => {
      const plan = await planEnergyCurve(deps, input.timelineId, input.curve);
      if (!plan.ok) throw toRpcError(plan.error);
      return plan.value;
    }),
  };

  /** The template's head moved back (or forward) as `head` says, through the templates' own setHead. */
  async function moveHead(
    head: NonNullable<Restore['templateHead']>,
    projectId: ProjectId,
    context: CommandContext,
  ) {
    const setHead = deps.templates.commands.find((command) => command.name === TEMPLATE_COMMANDS.setHead);
    if (!setHead) return err(NotFoundError({ entity: 'command', id: TEMPLATE_COMMANDS.setHead }));
    return setHead.handle({ projectId, ...head }, context);
  }

  const applyEnergyCurve = defineCommand({
    name: TIMELINE_COMMANDS.applyEnergyCurve,
    payload: timelineCommandPayloads[TIMELINE_COMMANDS.applyEnergyCurve],
    sideEffect: 'write',
    project: (p) => p.projectId,
    handle: async (p, context) => {
      const before = deps.timelines.get(p.timelineId);
      if (!before) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
      const ref = before.template;
      if (ref && ref.version !== p.templateBaseVersion)
        return err(
          ConflictError(
            { entity: 'timeline', id: before.id },
            {
              detail: `The timeline uses version ${ref.version}; the plan was made on ${p.templateBaseVersion}`,
            },
          ),
        );
      const split = await curveOnTimeline(deps, before, p.curve);
      if (!split.ok) return split;
      const picks = new Map(p.picks.map((entry) => [entry.slotId as string, entry.pick]));
      // Rebased first, so a refusal (a locked clip, media too short) leaves the template as it was.
      const head = split.value.base.version + 1;
      const edit = rebaseOnCurve(
        before,
        { split: split.value, picks, shots: deps.shots, source: context.source, ids: deps.ids.item },
        head,
      );
      if (!edit.ok) return err(edit.error);
      const checked = timelineSchema.safeParse({ ...edit.timeline, revision: before.revision + 1 });
      if (!checked.success)
        return err(
          timelineError('timeline.invalid_move', { detail: checked.error.issues[0]?.message ?? '' }),
        );
      const templateId = split.value.base.id;
      const stored = deps.templates.edit(
        { templateId, baseVersion: split.value.base.version, projectId: p.projectId },
        context.source,
        TEMPLATE_COMMANDS.setEnergyCurve,
        (_head, now) => ({ ok: true, template: { ...split.value.template, createdAt: now } }),
      );
      if (!stored.ok) return stored;
      const version = stored.value.result.version;
      const next =
        version === head ? edit.timeline : { ...edit.timeline, template: { id: templateId, version } };
      return deps.timelines.write(
        p.projectId,
        before,
        { ok: true, timeline: next },
        {
          name: ENERGY_RESTORE,
          payload: {
            projectId: p.projectId,
            timelineId: before.id,
            ...partsOf(before),
            templateHead: { templateId, version: split.value.base.version, expectedHead: version },
          },
        },
      );
    },
  });

  const restore = defineCommand({
    name: ENERGY_RESTORE,
    payload: RestorePayload,
    sideEffect: 'write',
    internal: true,
    project: (p) => p.projectId,
    handle: async (p, context) => {
      const { projectId, timelineId, templateHead, ...parts } = p;
      const before = deps.timelines.get(timelineId);
      if (!before) return err(timelineError('timeline.not_found', { timelineId }));
      if (templateHead) {
        const moved = await moveHead(templateHead, projectId, context);
        if (!moved.ok) return moved;
      }
      const restored = Object.fromEntries(Object.entries(parts).filter(([, value]) => value !== undefined));
      return deps.timelines.write(
        projectId,
        before,
        { ok: true, timeline: { ...before, ...restored } },
        {
          name: ENERGY_RESTORE,
          payload: {
            projectId,
            timelineId,
            ...partsOf(before),
            ...(templateHead
              ? {
                  templateHead: {
                    templateId: templateHead.templateId,
                    version: templateHead.expectedHead,
                    expectedHead: templateHead.version,
                  },
                }
              : {}),
          },
        },
      );
    },
  });

  const setEnergyCurve = defineCommand({
    name: TEMPLATE_COMMANDS.setEnergyCurve,
    payload: templateCommandPayloads[TEMPLATE_COMMANDS.setEnergyCurve],
    sideEffect: 'write',
    project: (p) => p.projectId,
    handle: async (p, context) => {
      const found = await deps.templates.get(p.templateId);
      if (!found) return err(NotFoundError({ entity: 'template', id: p.templateId }));
      if (found.summary.head !== p.baseVersion)
        return err(ConflictError({ entity: 'template', id: p.templateId }));
      const split = splitOnCurve(found.template, p.curve, energySlotIds(found.template, p.curve));
      if (!split.ok) return split;
      return deps.templates.edit(p, context.source, TEMPLATE_COMMANDS.setEnergyCurve, (_head, now) => ({
        ok: true,
        template: { ...split.value.template, createdAt: now },
      }));
    },
  });

  const commands: AnyCommand[] = [applyEnergyCurve, restore, setEnergyCurve];
  return { router, commands };
}
