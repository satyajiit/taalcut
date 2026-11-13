// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.applyEnergyCurve (P3-V12): the template version the curve makes (through the template service, with
 * `template.setEnergyCurve`'s change key, so redo finds the version again) and the timeline rebased onto it, in
 * one unit of work. The inverse restores the video, markers, cast and template ref, and moves the template's head
 * back, so one ⌘Z puts both where they were.
 */
import {
  ConflictError,
  defineCommand,
  err,
  NotImplementedError,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
  type AsyncResult,
  type CastCandidate,
  type CommandContext,
  type MediaRef,
  type Result,
  type Template,
  type TemplateId,
  type Timeline,
} from '@taalcut/core';
import type { z } from 'zod';
import { mediaRef } from '../casting/result';
import type { EditResult } from '../edits/types';
import { applyEnergy } from '../energy/apply-energy';
import type { EnergyDeps } from '../energy/energy-deps';
import { curveOnTimeline, type CurveOnTimeline } from '../energy/plan-energy';
import { commandItemIds } from '../model/derived-ids';
import { TemplateNotFound } from '../errors';
import { restorePayload, writeEdit, type CommandDeps } from './context';
import { profilesFor } from './resolve';

type EnergyPayload = z.output<(typeof payloads)[typeof TIMELINE_COMMANDS.applyEnergyCurve]>;
type TemplateRef = NonNullable<Timeline['template']>;

interface TemplateHead {
  readonly templateId: TemplateId;
  readonly version: number;
  readonly expectedHead: number;
}

/** One run of the command: what it was given, and what its inverse restores once the edit has made it. */
interface EnergyEdit {
  readonly deps: CommandDeps;
  readonly energy: EnergyDeps;
  readonly payload: EnergyPayload;
  readonly context: CommandContext;
  /** The document as it was and the version the template service made: both found inside the edit. */
  inverse: (ReturnType<typeof restorePayload> & { readonly templateHead: TemplateHead }) | null;
}

/** Media by candidate key (shot id, or `asset:<id>` for a photo). */
async function mediaFor(
  catalog: CommandDeps['catalog'],
  picks: readonly CastCandidate[],
): AsyncResult<Map<string, MediaRef>> {
  if (picks.length === 0) return ok(new Map<string, MediaRef>());
  const profiles = await profilesFor(catalog, picks);
  if (!profiles.ok) return profiles;
  return ok(new Map([...profiles.value].map(([key, profile]) => [key, mediaRef(profile)])));
}

/** The timeline's template ref, while it is still the version the plan was made on. */
function planBase(timeline: Timeline, payload: EnergyPayload): Result<TemplateRef> {
  const ref = timeline.template;
  if (!ref) return err(TemplateNotFound({ templateId: 'none' }));
  if (ref.version === payload.templateBaseVersion) return ok(ref);
  return err(
    ConflictError(
      { entity: 'timeline', id: timeline.id },
      {
        detail: `The timeline uses version ${ref.version}; the plan was made on ${payload.templateBaseVersion}`,
      },
    ),
  );
}

/** The timeline rebased onto the re-split template, with the plan's picks in the changed slots. */
async function rebased(
  edit: EnergyEdit,
  timeline: Timeline,
  split: CurveOnTimeline,
): AsyncResult<EditResult> {
  const { deps, payload, context } = edit;
  const media = await mediaFor(
    deps.catalog,
    payload.picks.map((entry) => entry.pick),
  );
  if (!media.ok) return media;
  return applyEnergy(
    timeline,
    {
      template: split.template,
      slotMap: split.slotMap,
      picks: new Map(payload.picks.map((entry) => [entry.slotId as string, entry.pick])),
      media: media.value,
    },
    {
      source: context.source,
      ids: deps.ids ?? commandItemIds(context.commandId),
      ...(deps.config ? { config: deps.config } : {}),
    },
  );
}

/** The re-split template stored as a new version, with `template.setEnergyCurve`'s change key. */
function storeVersion(edit: EnergyEdit, ref: TemplateRef, template: Template) {
  const { energy, payload, context } = edit;
  const templatePayload = templateCommandPayloads[TEMPLATE_COMMANDS.setEnergyCurve].parse({
    projectId: payload.projectId,
    templateId: ref.id,
    baseVersion: ref.version,
    curve: payload.curve,
  });
  return energy.templates.edit(
    {
      templateId: ref.id,
      baseVersion: ref.version,
      command: TEMPLATE_COMMANDS.setEnergyCurve,
      payload: templatePayload,
      change: () => ok(template),
    },
    context,
  );
}

/** The edit inside the unit of work: re-split, rebase, then store the template version and note the inverse. */
async function editOnCurve(edit: EnergyEdit, timeline: Timeline): AsyncResult<EditResult> {
  const ref = planBase(timeline, edit.payload);
  if (!ref.ok) return ref;
  const split = await curveOnTimeline(timeline, edit.payload.curve, edit.energy);
  if (!split.ok) return split;
  // Rebased first, so a refusal (a locked clip, media too short) leaves the template as it was.
  const edited = await rebased(edit, timeline, split.value);
  if (!edited.ok) return edited;
  const version = await storeVersion(edit, ref.value, split.value.template);
  if (!version.ok) return version;
  const head = version.value.version;
  edit.inverse = {
    ...restorePayload(timeline, edited.value.changed),
    templateHead: { templateId: ref.value.id, version: ref.value.version, expectedHead: head },
  };
  return ok({
    ...edited.value,
    timeline: { ...edited.value.timeline, template: { id: ref.value.id, version: head } },
  });
}

export function createEnergyCommands(deps: CommandDeps) {
  const apply = defineCommand({
    name: TIMELINE_COMMANDS.applyEnergyCurve,
    payload: payloads[TIMELINE_COMMANDS.applyEnergyCurve],
    sideEffect: 'write',
    handle: async (payload, context) => {
      if (!deps.energy) return err(NotImplementedError({ feature: 'timeline.energyCurve' }));
      const edit: EnergyEdit = { deps, energy: deps.energy, payload, context, inverse: null };
      const done = await writeEdit(deps, payload, context, (timeline) => editOnCurve(edit, timeline));
      if (!done.ok || !done.value.inverse || !edit.inverse) return done;
      return ok({ ...done.value, inverse: { name: TIMELINE_COMMANDS.restore, payload: edit.inverse } });
    },
  });

  return { apply, all: [apply] };
}
