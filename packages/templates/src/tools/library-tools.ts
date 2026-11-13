// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Templates the agent can find and read, and a slot plan made from a Format
 * (P2-T7, "Just describe it"). A format plan is saved unlisted: it's for this
 * brief, not "My templates", until the user saves it.
 *
 * `templates.search` (LRN1-TPL) finds templates by what they mean. It is a tool of its own rather than a mode of
 * `templates.list`: list pages through the library newest first and matches a reference's fingerprint; search ranks
 * by relevance (words, the template's meaning, a slot's intent) and says which of those found each hit. The
 * library's TemplateSearch does the work; without an embedding space it ranks by words alone and says so.
 */
import {
  artifactRefSchema,
  defineTool,
  FrameRates,
  NO_TOOL_RETRY,
  ok,
  TEMPLATE_COMMANDS,
  VIDEO_SIZES,
  type AnyTool,
  type TemplateEditResult,
  type TemplateId,
  type TemplateSearch,
  type TemplateSearchHit,
  type TemplateSummary,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { planFormat } from '../formats/plan-format';
import { sha256Hex } from '../store/change-key';
import type { TemplateToolDeps } from './deps';
import {
  getInputSchema,
  listInputSchema,
  listOutputSchema,
  plainTimeSchema,
  planFromFormatInputSchema,
  summaryOutputSchema,
  templateRefOutputSchema,
} from './schemas';
import { searchInputSchema, searchOutputSchema } from './search-schemas';

const MINUTE = 60_000;

const summaryOf = (summary: TemplateSummary): z.input<typeof summaryOutputSchema> => ({
  id: summary.id,
  name: summary.name,
  head: summary.head,
  origin: summary.origin,
  platform: summary.platform,
  duration: {
    value: summary.duration.value,
    rate: { num: summary.duration.rate.num, den: summary.duration.rate.den },
  },
  slotCount: summary.slotCount,
  bpm: summary.bpm,
  listed: summary.listed,
  archived: summary.archived,
});

export function planFromFormatTool(deps: TemplateToolDeps) {
  return defineTool({
    name: 'templates.planFromFormat',
    version: '1.0.0',
    summary: "Plans the slots of a reel from one of Taalcut's eight Formats on a beat grid.",
    description:
      "Plans a reel's slots from a Format for a target length of 6 to 120 seconds on a beat grid " +
      '(80-180 BPM, default from the format; optional aspect: 9:16, 16:9, 1:1 or 4:5). Formats: vlog, dayInTheLife, talkingHead (talking to ' +
      "camera), podcastClip, ugcAd (a product ad in the creator's own words), beforeAfter, tutorial " +
      '(how-to) and highlightReel. Saves the plan as an unlisted template version 1 for this brief and ' +
      'returns its id for casting. Undoable.',
    tags: [
      'format',
      'plan',
      'brief',
      'slots',
      'vlog',
      'day-in-the-life',
      'talking-head',
      'podcast',
      'ugc-ad',
      'before-after',
      'tutorial',
      'highlight-reel',
    ],
    input: planFromFormatInputSchema,
    mendInput: (raw) =>
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      typeof (raw as { brief?: unknown }).brief === 'string' &&
      (raw as { brief: string }).brief.length > 500
        ? { ...(raw as Record<string, unknown>), brief: (raw as { brief: string }).brief.slice(0, 500) }
        : raw,
    output: templateRefOutputSchema.extend({ slotCount: z.int().min(1) }),
    costClass: 'local',
    sideEffect: 'write',
    command: TEMPLATE_COMMANDS.create,
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { write: ['library'] } },
    idempotencyKey: (input) =>
      `plan:${sha256Hex(JSON.stringify([input.projectId, input.formatId, input.targetSeconds, input.bpm, input.brief, input.aspect]))}`,
    run: async (input, ctx) => {
      const planned = planFormat(
        {
          formatId: input.formatId,
          targetSeconds: input.targetSeconds,
          ...(input.bpm !== undefined ? { bpm: input.bpm } : {}),
          ...(input.aspect !== undefined
            ? { canvas: { ...VIDEO_SIZES[input.aspect], rate: FrameRates.fps30 } }
            : {}),
          brief: input.brief ?? null,
          createdAt: deps.clock.now(),
        },
        deps.ids,
      );
      if (!planned.ok) return planned;
      const template = planned.value;
      const name = `${input.formatId} plan, ${input.targetSeconds} s`;
      const created = await ctx.dispatch({ projectId: input.projectId, template, name, listed: false });
      if (!created.ok) return created;
      // A repeat with the same key gets the first call's template back from the bus, not this new id.
      const { templateId, version } = created.value as TemplateEditResult;
      return ok({ templateId, version, slotCount: template.slots.length });
    },
  });
}

export function listTool(deps: TemplateToolDeps) {
  return defineTool({
    name: 'templates.list',
    version: '1.0.0',
    summary: "Finds the user's templates by words or by a reference's fingerprint.",
    description:
      "Finds the user's templates by words in their name, slot intents or overlay text, or by the " +
      "reference's fingerprint (a reel broken down before). Newest first; archived ones are left out.",
    tags: ['template', 'search', 'list', 'my-templates'],
    input: listInputSchema,
    output: listOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    cache: { ttlMs: MINUTE },
    permission: { filesystem: { read: ['library'] } },
    run: async (input) => {
      const page = await deps.service.list({
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(input.fingerprint !== undefined ? { fingerprint: input.fingerprint } : {}),
        includeUnlisted: input.includeUnlisted ?? false,
        includeArchived: false,
        limit: input.limit ?? 20,
      });
      if (!page.ok) return page;
      return ok({ items: page.value.items.map(summaryOf) });
    },
  });
}

const slotLineSchema = z.object({
  index: z.int(),
  id: ulidSchema('TemplateSlot'),
  role: z.string(),
  name: z.string().nullable(),
  start: plainTimeSchema,
  duration: plainTimeSchema,
  intent: z.string(),
  intentSource: z.string(),
  shotType: z.string().nullable().optional(),
  motion: z.string().nullable().optional(),
  energy: z.number().optional(),
  needs: z.array(z.string()).optional(),
  face: z.enum(['shown', 'hidden']).nullable().optional(),
  reel: z.string().optional(),
  approved: z.boolean(),
});

const overlayLineSchema = z.object({
  id: ulidSchema('TextOverlay'),
  text: z.string(),
  role: z.string(),
  start: plainTimeSchema,
  duration: plainTimeSchema,
  kind: z.string().optional(),
  designed: z.boolean(),
});

const speechLineSchema = z.object({
  start: plainTimeSchema,
  duration: plainTimeSchema,
  text: z.string(),
});

const WATERMARK_HANDLE_RE = /^@[A-Za-z0-9._-]+(?:\s+[A-Za-z0-9._-]+)?\.?$/;

export function getTool(deps: TemplateToolDeps) {
  return defineTool({
    name: 'templates.get',
    version: '1.0.0',
    description:
      'Reads a template (default its head version): its summary and one line per slot (role, timing, intent, ' +
      'approved). The whole document is stored as an artifact. Use baseVersion = version for slot edits.',
    tags: ['template', 'read', 'slots'],
    input: getInputSchema,
    output: z.object({
      summary: summaryOutputSchema,
      version: z.int().min(1),
      slots: z.array(slotLineSchema),
      overlays: z.array(overlayLineSchema).optional(),
      speech: z.array(speechLineSchema).optional(),
      document: artifactRefSchema.optional(),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    cache: { ttlMs: MINUTE },
    permission: { filesystem: { read: ['library'] } },
    summarize: (output) =>
      `${output.summary.name}, version ${output.version}: ${output.slots.length} slots, ` +
      `${output.slots.filter((slot) => slot.approved).length} approved.`,
    run: async (input, ctx) => {
      const got = await deps.service.get({
        templateId: input.templateId as TemplateId,
        ...(input.version !== undefined ? { version: input.version } : {}),
      });
      if (!got.ok) return got;
      const { summary, template } = got.value;
      const time = (t: { value: number; rate: { num: number; den: number } }) => ({
        value: t.value,
        rate: { num: t.rate.num, den: t.rate.den },
      });
      const document = await ctx.artifacts.put({
        mediaType: 'application/json',
        data: JSON.stringify(template),
        summary: `Template ${summary.name}, version ${template.version}, as JSON.`,
      });
      const nonWatermarkOverlays = template.text.filter(
        (overlay) => !WATERMARK_HANDLE_RE.test(overlay.text.trim()),
      );
      const speechSegments = template.audio.speech?.segments ?? [];
      return ok({
        summary: summaryOf(summary),
        version: template.version,
        slots: template.slots.map((slot, index) => ({
          index,
          id: slot.id,
          role: slot.role,
          name: slot.name,
          start: time(slot.start),
          duration: time(slot.duration),
          intent: slot.intent.text,
          intentSource: slot.intent.source,
          shotType: slot.intent.shotType,
          motion: slot.intent.motion,
          energy: slot.intent.energy,
          ...(slot.intent.needs && slot.intent.needs.length > 0 ? { needs: [...slot.intent.needs] } : {}),
          ...(slot.intent.face !== undefined ? { face: slot.intent.face } : {}),
          ...(slot.intent.reel ? { reel: slot.intent.reel } : {}),
          approved: slot.approved,
        })),
        ...(nonWatermarkOverlays.length > 0
          ? {
              overlays: nonWatermarkOverlays.map((overlay) => ({
                id: overlay.id,
                text: overlay.text,
                role: overlay.role,
                start: time(overlay.start),
                duration: time(overlay.duration),
                ...(overlay.design?.kind ? { kind: overlay.design.kind } : {}),
                designed: overlay.design !== undefined,
              })),
            }
          : {}),
        ...(speechSegments.length > 0
          ? {
              speech: speechSegments.map((seg) => ({
                start: time(seg.start),
                duration: time(seg.duration),
                text: seg.text,
              })),
            }
          : {}),
        ...(document.ok ? { document: document.value } : {}),
      });
    },
  });
}

const hitOf = ({ summary, score, matchedBy, slotId }: TemplateSearchHit) => ({
  id: summary.id,
  name: summary.name,
  head: summary.head,
  origin: summary.origin,
  platform: summary.platform,
  duration: {
    value: summary.duration.value,
    rate: { num: summary.duration.rate.num, den: summary.duration.rate.den },
  },
  slotCount: summary.slotCount,
  score,
  matchedBy: [...matchedBy],
  slotId,
});

function summarize(output: z.output<typeof searchOutputSchema>): string {
  const how = output.degraded === null ? 'by words and meaning' : 'by words only (no embedding model yet)';
  return `${output.hits.length} templates found ${how}.`;
}

/** No tool without a search: the composition root passes one wherever the library database is open. */
export function searchTools(search: TemplateSearch | undefined): AnyTool[] {
  if (!search) return [];
  const tool = defineTool({
    name: 'templates.search',
    version: '1.0.0',
    summary: "Finds the user's templates by what they mean: words, the whole template, or one slot's intent.",
    description:
      "Finds the user's templates that match a description of what they want to make, best first: by words in " +
      'the name, slot intents and overlays, by the template as a whole ("a calm morning routine") and by a single ' +
      'slot\'s intent ("a close-up of pouring coffee"). Each hit says which of these matched it and, for a slot ' +
      'match, which slot. Use it rather than templates.list when the user describes a feel, a subject or a shot; ' +
      'templates.list is for browsing newest first or a reference fingerprint. Archived templates are left out.',
    tags: ['template', 'search', 'semantic', 'meaning', 'my-templates'],
    input: searchInputSchema,
    output: searchOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    cache: { ttlMs: MINUTE },
    idempotencyKey: (input) => `templates.search:${sha256Hex(JSON.stringify(input))}`,
    permission: { filesystem: { read: ['library'] } },
    summarize,
    run: async (input, ctx) => {
      const found = await search.search(
        {
          text: input.text,
          includeUnlisted: input.includeUnlisted ?? false,
          includeArchived: false,
          limit: input.limit ?? 10,
          ...(input.formatId !== undefined ? { formatId: input.formatId } : {}),
          ...(input.origin !== undefined ? { origin: input.origin } : {}),
        },
        ctx.signal,
      );
      if (!found.ok) return found;
      return ok({
        hits: found.value.hits.map(hitOf),
        degraded: found.value.degraded,
        fusion: found.value.fusion,
      });
    },
  });
  return [tool as AnyTool];
}
