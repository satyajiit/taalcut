// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `appContract.templates` and the template slot commands, as the renderer's
 * fake serves them. Versions are immutable: every slot edit makes the next
 * version from the head it names (`baseVersion`, else `core.conflict`), and
 * its inverse is `template.setHead` back to the version it was made on, so
 * ⌘Z and the card's Undo both work through the bus. Each change is a
 * `library.changed` event for the template, which the pages and cards watch. Library facts (tags, folder,
 * favourite, trend date, provenance, archived) sit beside the lineage, never in a version; `templates.list`
 * filters and sorts by them as the service does (template-query.ts). `count` seeds a library of that size.
 */
import {
  ConflictError,
  defineCommand,
  err,
  NotFoundError,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  type NO_TEMPLATE_LIBRARY_META,
  STALE_AFTER_DAYS_SETTING,
  ValidationError,
  type AnyCommand,
  type CommandSource,
  type EventBus,
  type FormatId,
  type FormatSummary,
  type Id,
  type Template,
  type TemplateListQuery,
  type TemplateMedia,
  type TemplateSummary,
  type TemplateVersionSummary,
} from '@taalcut/core';
import { approveSlots, dropSlot, mergeSlots, renameSlot, type SlotEditResult } from './template-edits';
import {
  buildTemplate,
  GOLDEN_HOUR,
  TEMPLATE_PLANS,
  TEMPLATE_T0,
  withFlatWaveform,
  type TemplatePlan,
} from './template-data';
import { selectTemplates, type QueryRow } from './template-query';
import { allTokens, columnsOf } from './template-terms';
import { TEMPLATE_FORMATS } from './template-formats';
import { headOf, keptMedia, summary, type Lineage } from './template-lineage';
import { BASE_META, seedLibrary, type LibraryMeta } from './template-seed-library';
import { reviewTemplates } from './template-review-plans';
import { reviewCommands } from './fake-review-commands';

export type { LibraryMeta } from './template-seed-library';

export interface FakeTemplatesOptions {
  /** No saved templates (the empty page). */
  readonly empty?: boolean;
  /** How many templates the library holds (P3-V14 at scale); at least the three hand-made ones. */
  readonly count?: number;
  readonly latencyMs?: number;
  /**
   * REF1 (keep's request 41): Slow morning routine's waveform as a breakdown stored it before keep's `04e87739`,
   * clamped flat (nearly every peak 1).
   */
  readonly flatWaveform?: boolean;
}

const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export function createFakeTemplates(events: EventBus, options: FakeTemplatesOptions = {}) {
  const lineages = new Map<Id<'Template'>, Lineage>();
  if (!options.empty) {
    for (const plan of TEMPLATE_PLANS) {
      const built = buildTemplate(plan);
      const template = options.flatWaveform && plan.n === 2 ? withFlatWaveform(built) : built;
      const base = BASE_META[plan.n];
      lineages.set(template.id, {
        name: plan.name,
        meta: base?.meta ?? {},
        used: base?.used ?? 0,
        versions: [{ template, command: null, source: null }],
        head: 1,
        updatedAt: template.createdAt,
        // REF1: Golden hour keeps its reel; Slow morning routine was read before REF1, so it has none yet.
        media: plan.n === 1 ? keptMedia(template, template.createdAt) : null,
      });
    }
    for (const seed of seedLibrary(options.count ?? 0))
      lineages.set(seed.template.id, {
        name: seed.name,
        meta: seed.meta,
        used: seed.used,
        versions: [{ template: seed.template, command: null, source: null }],
        head: 1,
        updatedAt: seed.updatedAt,
        media: seed.template.origin.kind === 'reference' ? keptMedia(seed.template, seed.updatedAt) : null,
      });
    // BRK1-REV: the review's two reels, read in a chat and not saved (unlisted), each keeping its reel.
    for (const { template, name } of reviewTemplates())
      lineages.set(template.id, {
        name,
        meta: { listed: false },
        used: 0,
        versions: [{ template, command: null, source: null }],
        head: 1,
        updatedAt: template.createdAt,
        media: keptMedia(template, template.createdAt),
      });
    // Golden hour has a history: the first two slots were approved after the breakdown.
    const golden = lineages.get(buildTemplate(GOLDEN_HOUR).id)!;
    const v1 = golden.versions[0]!.template;
    const approved = approveSlots(v1, [v1.slots[0]!.id, v1.slots[1]!.id], true, TEMPLATE_T0);
    if (approved.ok) {
      golden.versions.push({
        template: approved.template,
        command: TEMPLATE_COMMANDS.approveSlots,
        source: 'ui',
      });
      golden.head = 2;
      golden.updatedAt = TEMPLATE_T0;
    }
  }

  const changed = (id: Id<'Template'>, change: 'created' | 'updated' | 'deleted' = 'updated') =>
    events.emit('library.changed', { projectId: null, entity: 'template', change, ids: [id] });

  /** Runs one structural edit on the head named by baseVersion; the inverse puts that head back. */
  function edit(
    payload: { templateId: Id<'Template'>; baseVersion: number; projectId: Id<'Project'> | null },
    source: CommandSource,
    name: string,
    apply: (template: Template, now: number) => SlotEditResult,
  ) {
    const lineage = lineages.get(payload.templateId);
    if (!lineage) return err(NotFoundError({ entity: 'template', id: payload.templateId }));
    if (payload.baseVersion !== lineage.head)
      return err(ConflictError({ entity: 'template', id: payload.templateId }));
    const head = lineage.versions[lineage.head - 1]!.template;
    const now = Date.now();
    const next = apply(head, now);
    if (!next.ok) return err(next.error ?? ValidationError(undefined, { detail: next.reason }));
    const version = { ...next.template, version: lineage.versions.length + 1, parentVersion: head.version };
    lineage.versions.push({ template: version, command: name, source });
    lineage.head = version.version;
    lineage.updatedAt = now;
    changed(payload.templateId);
    return ok({
      result: { templateId: payload.templateId, version: version.version },
      inverse: {
        name: TEMPLATE_COMMANDS.setHead,
        payload: {
          projectId: payload.projectId,
          templateId: payload.templateId,
          version: head.version,
          expectedHead: version.version,
        },
      },
    });
  }

  const P = templateCommandPayloads;
  const commands: AnyCommand[] = [
    defineCommand({
      name: TEMPLATE_COMMANDS.renameSlot,
      payload: P[TEMPLATE_COMMANDS.renameSlot],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, TEMPLATE_COMMANDS.renameSlot, (t, now) => renameSlot(t, p.slotId, p.name, now)),
    }),
    defineCommand({
      name: TEMPLATE_COMMANDS.mergeSlots,
      payload: P[TEMPLATE_COMMANDS.mergeSlots],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, TEMPLATE_COMMANDS.mergeSlots, (t, now) =>
          mergeSlots(t, p.slotIds, p.intentFrom, now),
        ),
    }),
    defineCommand({
      name: TEMPLATE_COMMANDS.dropSlot,
      payload: P[TEMPLATE_COMMANDS.dropSlot],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, TEMPLATE_COMMANDS.dropSlot, (t, now) => dropSlot(t, p.slotId, now)),
    }),
    // BRK1-REV: the review's own (moving and adding cuts, roles, descriptions, text, tempo, doubts).
    ...reviewCommands(edit),
    defineCommand({
      name: TEMPLATE_COMMANDS.approveSlots,
      payload: P[TEMPLATE_COMMANDS.approveSlots],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, ctx) =>
        edit(p, ctx.source, TEMPLATE_COMMANDS.approveSlots, (t, now) =>
          approveSlots(t, p.slotIds, p.approved, now),
        ),
    }),
    defineCommand({
      name: TEMPLATE_COMMANDS.setHead,
      payload: P[TEMPLATE_COMMANDS.setHead],
      sideEffect: 'write',
      internal: true,
      project: (p) => p.projectId,
      handle: (p) => {
        const lineage = lineages.get(p.templateId);
        if (!lineage) return err(NotFoundError({ entity: 'template', id: p.templateId }));
        if (lineage.head !== p.expectedHead || p.version > lineage.versions.length)
          return err(ConflictError({ entity: 'template', id: p.templateId }));
        const before = lineage.head;
        lineage.head = p.version;
        lineage.updatedAt = Date.now();
        changed(p.templateId);
        return ok({
          result: { templateId: p.templateId, version: p.version },
          inverse: {
            name: TEMPLATE_COMMANDS.setHead,
            payload: {
              projectId: p.projectId,
              templateId: p.templateId,
              version: before,
              expectedHead: p.version,
            },
          },
        });
      },
    }),
  ];

  return {
    commands,
    /**
     * Phase 3 (ui-make): another area's command makes the next version of a template from the head it names
     * (template.setStyle, template.setEnergyCurve…), with template.setHead as its inverse.
     */
    edit,
    /** Phase 3: a template made elsewhere (a hub fork, an imported file) joins the library as version 1. */
    create(
      template: Template,
      name: string,
      command: string,
      source: CommandSource,
      meta?: Partial<typeof NO_TEMPLATE_LIBRARY_META>,
    ) {
      lineages.set(template.id, {
        name,
        meta: meta ?? {},
        used: 0,
        versions: [{ template: { ...template, version: 1, parentVersion: null }, command, source }],
        head: 1,
        updatedAt: Date.now(),
      });
      changed(template.id, 'created');
    },
    /**
     * template.addStarter (P3-B3): a bundled starter forked under the caller's id. Its origin is the format it
     * fills, with no reference and no contact sheet (D9: structure only).
     */
    adopt(
      templateId: Id<'Template'>,
      plan: TemplatePlan,
      formatId: FormatId,
      meta?: Partial<typeof NO_TEMPLATE_LIBRARY_META>,
    ) {
      const built = buildTemplate(plan);
      const now = Date.now();
      const template: Template = {
        ...built,
        id: templateId,
        createdAt: now,
        origin: { kind: 'format', formatId, formatVersion: '1', target: built.duration, brief: null },
        contactSheet: null,
        // No contact sheet, so no slot names a tile of one.
        slots: built.slots.map((slot) => ({ ...slot, frame: null })),
        audio: { ...built.audio, sound: null, waveform: null },
      };
      lineages.set(templateId, {
        name: plan.name,
        meta: meta ?? {},
        used: 0,
        versions: [{ template, command: TEMPLATE_COMMANDS.addStarter, source: 'ui' }],
        head: 1,
        updatedAt: now,
      });
      changed(templateId, 'created');
    },
    /** The inverse of adopt and of create (template.discard, template.discardMany): gone when unused, else archived. */
    discard(templateId: Id<'Template'>) {
      const lineage = lineages.get(templateId);
      if (!lineage) return;
      if (lineage.used === 0) {
        lineages.delete(templateId);
        changed(templateId, 'deleted');
      } else {
        lineage.meta = { ...lineage.meta, archived: true };
        lineage.updatedAt = Date.now();
        changed(templateId);
      }
    },
    /** P3-V14: a lineage's library facts (the store's setMeta): no new version; `updatedAt` moves. */
    setMeta(
      templateId: Id<'Template'>,
      patch: Partial<LibraryMeta> & { name?: string },
      /** False when the caller announces a batch itself (announce). */
      announce = true,
    ): TemplateSummary | null {
      const lineage = lineages.get(templateId);
      if (!lineage) return null;
      const { name, ...meta } = patch;
      if (name !== undefined) lineage.name = name;
      lineage.meta = { ...lineage.meta, ...meta };
      lineage.updatedAt = Date.now();
      if (announce) changed(templateId);
      return summary(lineage);
    },
    /** One `library.changed` for a batch of setMeta calls (a move of 200 templates is one event). */
    announce(ids: readonly Id<'Template'>[]) {
      if (ids.length > 0)
        events.emit('library.changed', {
          projectId: null,
          entity: 'template',
          change: 'updated',
          ids: [...ids],
        });
    },
    /** REF1: the template keeps `media` as its reel (templates.fetchMedia), or forgets it (null); no new version. */
    keepMedia(templateId: Id<'Template'>, media: TemplateMedia | null): TemplateSummary | null {
      const lineage = lineages.get(templateId);
      if (!lineage) return null;
      lineage.media = media;
      changed(templateId);
      return summary(lineage);
    },
    /** Timelines made from the template (template.discardMany keeps a used one, archived). */
    usedBy: (templateId: Id<'Template'>) => lineages.get(templateId)?.used ?? 0,
    summary(templateId: Id<'Template'>): TemplateSummary | null {
      const lineage = lineages.get(templateId);
      return lineage ? summary(lineage) : null;
    },
    /** Every template's summary, archived and unlisted too (folder counts). */
    summaries: (): TemplateSummary[] => [...lineages.values()].map(summary),
    /** A template's head, or the version asked for. */
    template(templateId: Id<'Template'>, version?: number): Template | null {
      const lineage = lineages.get(templateId);
      return (lineage && lineage.versions[(version ?? lineage.head) - 1]?.template) ?? null;
    },
    async list(query: TemplateListQuery) {
      await wait(options.latencyMs ?? 0);
      const rows: QueryRow[] = [...lineages.values()].map((lineage) => {
        const item = summary(lineage);
        const head = headOf(lineage);
        return {
          summary: item,
          used: lineage.used,
          tokens: allTokens(columnsOf(item.name, item.tags, head)),
          fingerprints: lineage.versions.flatMap(({ template }) =>
            template.origin.kind === 'reference' ? [template.origin.fingerprint] : [],
          ),
        };
      });
      return selectTemplates(rows, query, Date.now(), STALE_AFTER_DAYS_SETTING.defaultValue);
    },
    async get(templateId: Id<'Template'>, version?: number) {
      await wait(options.latencyMs ?? 0);
      const lineage = lineages.get(templateId);
      const entry = lineage?.versions[(version ?? lineage.head) - 1];
      return lineage && entry ? { summary: summary(lineage), template: entry.template } : null;
    },
    versions(templateId: Id<'Template'>): TemplateVersionSummary[] | null {
      const lineage = lineages.get(templateId);
      if (!lineage) return null;
      return lineage.versions
        .map(({ template, command, source }) => ({
          version: template.version,
          parentVersion: template.parentVersion,
          createdAt: template.createdAt,
          command,
          source,
          isHead: template.version === lineage.head,
        }))
        .reverse();
    },
    formats: (): FormatSummary[] => [...TEMPLATE_FORMATS],
  };
}

export type FakeTemplates = ReturnType<typeof createFakeTemplates>;
