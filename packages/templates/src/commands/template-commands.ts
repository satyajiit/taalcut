// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for every TEMPLATE_COMMANDS name (core template-commands.ts), for
 * the agent process's bus. The breakdown card, /templates and the agent
 * dispatch the same commands, so each edit gets one undo entry and one audit
 * row whoever made it.
 *
 * Structural edits make a new immutable version (template-service.ts) and are
 * undone by the internal `template.setHead` back to the edited version; redo
 * runs the edit again, which finds that version by its change key. Name,
 * listing and archive are lineage metadata: undoable, no version. Create is
 * undone by the internal `template.discard` (deleted when unused, else
 * archived).
 */
import {
  ConflictError,
  defineCommand,
  err,
  newId,
  NotFoundError,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  ValidationError,
  type AnyCommand,
  type CommandContext,
  type ProjectId,
  type Result,
  type SlotId,
  type Template,
  type TemplateEditResult,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';
import type { z } from 'zod';
import { moveCut, splitSlot } from '../edits/cut-edits';
import { editGraphic, setGraphic } from '../edits/graphic-edits';
import {
  dismissDoubt,
  removeText,
  setMotion,
  setRole,
  setSoundCredit,
  setTempo,
} from '../edits/review-edits';
import { setGraphics } from '../edits/graphics-edits';
import { approveSlots, dropSlot, editIntent, mergeSlots, renameSlot } from '../edits/slot-edits';
import { TemplateInUse } from '../errors';
import type { TemplateService } from '../store/template-service';
import { storedSummary } from '../store/stored-summary';

const N = TEMPLATE_COMMANDS;
const P = templateCommandPayloads;

type EditName =
  | typeof N.approveSlots
  | typeof N.renameSlot
  | typeof N.mergeSlots
  | typeof N.dropSlot
  | typeof N.editIntent
  | typeof N.moveCut
  | typeof N.splitSlot
  | typeof N.setRole
  | typeof N.removeText
  | typeof N.setTempo
  | typeof N.dismissDoubt
  | typeof N.setSoundCredit
  | typeof N.setMotion
  | typeof N.setGraphic
  | typeof N.editGraphic
  | typeof N.setGraphics;

interface EditPayload {
  readonly projectId: ProjectId | null;
  readonly templateId: TemplateId;
  readonly baseVersion: number;
}

export interface TemplateCommandDeps {
  readonly service: TemplateService;
  readonly store: TemplateStore;
  /** A split's new slot id (newId by default; a counter in tests). */
  readonly slotId?: () => SlotId;
}

const setHeadInverse = (
  where: { readonly projectId: ProjectId | null; readonly templateId: TemplateId },
  version: number,
  expectedHead: number,
) => ({ name: N.setHead, payload: { ...where, version, expectedHead } });

export function createTemplateCommands({ service, store, slotId = () => newId() }: TemplateCommandDeps) {
  function edit<S extends z.ZodType<EditPayload>>(
    name: EditName,
    schema: S,
    change: (template: Template, payload: z.output<S>, context: CommandContext) => Result<Template>,
  ) {
    return defineCommand({
      name,
      payload: schema,
      sideEffect: 'write',
      handle: async (payload: z.output<S>, context) => {
        const { projectId, templateId, baseVersion } = payload;
        const outcome = await service.edit(
          { templateId, baseVersion, command: name, payload, change: (t) => change(t, payload, context) },
          context,
        );
        if (!outcome.ok) return outcome;
        const result: TemplateEditResult = { templateId, version: outcome.value.version };
        return ok({
          result,
          inverse: setHeadInverse({ projectId, templateId }, baseVersion, result.version),
        });
      },
    });
  }

  const summary = (templateId: TemplateId) => storedSummary(store, templateId);

  const create = defineCommand({
    name: N.create,
    payload: P[N.create],
    sideEffect: 'write',
    handle: async ({ projectId, template, name, listed }, context) => {
      if (template.version !== 1 || template.parentVersion !== null)
        return err(ValidationError({ field: 'template.version' }, { detail: 'A new template is version 1' }));
      const existing = await store.get(template.id);
      if (existing.ok) {
        // Redo after an undo that archived it (a timeline used it): bring it back instead of a second copy.
        if (!existing.value.summary.archived)
          return err(ConflictError({ entity: 'template', id: template.id }));
        const restored = await store.setMeta(template.id, { archived: false }, context);
        if (!restored.ok) return restored;
      } else if (NotFoundError.is(existing.error)) {
        const created = await store.create(template, { name, projectId, listed }, context);
        if (!created.ok) return created;
      } else return existing;
      const result: TemplateEditResult = { templateId: template.id, version: 1 };
      return ok({ result, inverse: { name: N.discard, payload: { projectId, templateId: template.id } } });
    },
  });

  const discard = defineCommand({
    name: N.discard,
    payload: P[N.discard],
    sideEffect: 'write',
    internal: true,
    handle: async ({ templateId }, context) => {
      const used = await store.usedBy(templateId);
      if (!used.ok) return used;
      const done =
        used.value === 0
          ? await store.remove(templateId, context)
          : await store.setMeta(templateId, { archived: true }, context);
      return done.ok ? ok({ result: { templateId } }) : done;
    },
  });

  const rename = defineCommand({
    name: N.rename,
    payload: P[N.rename],
    sideEffect: 'write',
    handle: async ({ projectId, templateId, name }, context) => {
      const before = await summary(templateId);
      if (!before.ok) return before;
      const after = await store.setMeta(templateId, { name }, context);
      if (!after.ok) return after;
      return ok({
        result: { templateId, name },
        inverse: { name: N.rename, payload: { projectId, templateId, name: before.value.name } },
      });
    },
  });

  const setListed = defineCommand({
    name: N.setListed,
    payload: P[N.setListed],
    sideEffect: 'write',
    handle: async ({ projectId, templateId, listed }, context) => {
      const before = await summary(templateId);
      if (!before.ok) return before;
      const after = await store.setMeta(templateId, { listed }, context);
      if (!after.ok) return after;
      return ok({
        result: { templateId, listed },
        inverse: { name: N.setListed, payload: { projectId, templateId, listed: before.value.listed } },
      });
    },
  });

  const archive = defineCommand({
    name: N.archive,
    payload: P[N.archive],
    sideEffect: 'write',
    handle: async ({ projectId, templateId, archived }, context) => {
      const before = await summary(templateId);
      if (!before.ok) return before;
      const after = await store.setMeta(templateId, { archived }, context);
      if (!after.ok) return after;
      return ok({
        result: { templateId, archived },
        inverse: { name: N.archive, payload: { projectId, templateId, archived: before.value.archived } },
      });
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'destructive',
    handle: async ({ templateId }, context) => {
      const used = await store.usedBy(templateId);
      if (!used.ok) return used;
      // A timeline points at (template, version): archive instead, so it keeps opening.
      if (used.value > 0) return err(TemplateInUse({ timelines: used.value }));
      const removed = await store.remove(templateId, context);
      return removed.ok ? ok({ result: { templateId } }) : removed;
    },
  });

  const setHead = defineCommand({
    name: N.setHead,
    payload: P[N.setHead],
    sideEffect: 'write',
    internal: true,
    handle: async ({ templateId, version, expectedHead }, context) => {
      const moved = await store.setHead({ templateId, version, expectedHead }, context);
      if (moved.ok) return ok({ result: { templateId, version } satisfies TemplateEditResult });
      return ConflictError.is(moved.error)
        ? err(
            ConflictError(
              { entity: 'template', id: templateId },
              { detail: 'This template changed since; undo the newer change first' },
            ),
          )
        : moved;
    },
  });

  const author = (context: CommandContext) => (context.source === 'agent' ? 'analyst' : 'user');
  const approve = edit(N.approveSlots, P[N.approveSlots], (t, p) => approveSlots(t, p));
  const renameOne = edit(N.renameSlot, P[N.renameSlot], (t, p) => renameSlot(t, p));
  const merge = edit(N.mergeSlots, P[N.mergeSlots], (t, p) => mergeSlots(t, p));
  const drop = edit(N.dropSlot, P[N.dropSlot], (t, p) => dropSlot(t, p));
  const intent = edit(N.editIntent, P[N.editIntent], (t, p, context) => editIntent(t, p, author(context)));
  // BRK1: the review's edits.
  const move = edit(N.moveCut, P[N.moveCut], (t, p) => moveCut(t, { ...p, at: p.to }));
  const split = edit(N.splitSlot, P[N.splitSlot], (t, p) => splitSlot(t, p, slotId()));
  const role = edit(N.setRole, P[N.setRole], (t, p) => setRole(t, p));
  const notText = edit(N.removeText, P[N.removeText], (t, p) => removeText(t, p));
  const tempo = edit(N.setTempo, P[N.setTempo], (t, p) => setTempo(t, p));
  const dismiss = edit(N.dismissDoubt, P[N.dismissDoubt], (t, p) => dismissDoubt(t, p));
  // BRK1-REV: the reel's sound credit, from the review's "Add the credit".
  const credit = edit(N.setSoundCredit, P[N.setSoundCredit], (t, p) => setSoundCredit(t, p));
  // FRM1-MOT: the camera's move the person picked in the review.
  const motion = edit(N.setMotion, P[N.setMotion], (t, p) => setMotion(t, p));
  // DSG1-READ: the review's "Not a graphic", its restore, and a brief's words.
  const graphic = edit(N.setGraphic, P[N.setGraphic], (t, p) => setGraphic(t, p));
  const brief = edit(N.editGraphic, P[N.editGraphic], (t, p) => editGraphic(t, p));
  // DSG1-AUT: the designed components and the overlays they draw.
  const graphics = edit(N.setGraphics, P[N.setGraphics], (t, p) => setGraphics(t, p));

  const all: AnyCommand[] = [
    create,
    rename,
    setListed,
    archive,
    remove,
    approve,
    renameOne,
    merge,
    drop,
    intent,
    move,
    split,
    role,
    notText,
    tempo,
    dismiss,
    credit,
    motion,
    graphic,
    brief,
    graphics,
    setHead,
    discard,
  ] as AnyCommand[];

  return {
    create,
    rename,
    setListed,
    archive,
    remove,
    approveSlots: approve,
    renameSlot: renameOne,
    mergeSlots: merge,
    dropSlot: drop,
    editIntent: intent,
    moveCut: move,
    splitSlot: split,
    setRole: role,
    removeText: notText,
    setTempo: tempo,
    dismissDoubt: dismiss,
    setSoundCredit: credit,
    setMotion: motion,
    setGraphic: graphic,
    editGraphic: brief,
    setGraphics: graphics,
    setHead,
    discard,
    all,
  };
}

export type TemplateCommands = ReturnType<typeof createTemplateCommands>;
