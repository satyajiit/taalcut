// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: `video.compare`, the draft next to the reel. For one slot or all of them it cuts the kept reel's frame
 * and the newest draft's at the same share of each slot (compare-plan.ts) and returns them as sheets: one row per
 * slot moment, the reel on the left and the draft on the right (frames.ts), a few pictures for a whole video. Beside
 * them, each slot's facts in words (the template's intent, needs, face, shot and timing, where its clip sits now and
 * in the draft, the cast's score), and each frame as an artifact to describe or draw over. The reel's frames always
 * go to a model that sees images (a reference's, FIX-CONSENT); the draft's only where the person's frames may
 * (pictures.ts), else the sheets hold the reel alone and the words say why. With judge, a vision judge says per slot
 * what differs (slot-judge.ts). Caps: COMPARE_ROWS_MAX rows (so COMPARE_SHEETS_MAX pictures) and
 * JUDGE_SLOTS_MAX judged slots a call; slots past them are left for another call.
 */
import { mkdir } from 'node:fs/promises';
import {
  defineTool,
  err,
  NO_TOOL_RETRY,
  ok,
  RationalTime,
  ValidationError,
  type AnyTool,
  type ArtifactRef,
  type AsyncResult,
  type RenderId,
  type RenderRecord,
  type Timeline,
  type ToolContextBase,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { slotFactsOf, slotPlacesOf } from '@taalcut/timeline';
import { planCompare, type Cut, type PlannedRow, type PlannedSlot } from './compare-plan';
import {
  compareInputSchema,
  compareOutputSchema,
  COMPARE_ROWS_MAX,
  COMPARE_SHEETS_MAX,
  ROWS_PER_SHEET,
  type CompareInput,
  type CompareOutput,
  type CompareSlot,
} from './compare-schema';
import type { EyesDeps } from './deps';
import { cellOf, sheetOf, stillAt, type CellSize } from './frames';
import { footageVerdict, type FootagePicturesOut } from './pictures';
import { judgeSlots } from './compare-judge';

/** Renders with a file a person could watch. */
const WATCHABLE = new Set(['ready', 'needsAttention']);

/** The render to compare: the one asked for, or the timeline's newest with a file; null before the first. */
async function draftOf(
  deps: EyesDeps,
  timeline: Timeline,
  renderId?: string,
): AsyncResult<RenderRecord | null> {
  if (renderId) {
    const got = await deps.renders.get(renderId as RenderId);
    if (!got.ok) return got;
    if (got.value.timelineId !== timeline.id)
      return err(
        ValidationError(
          { field: 'renderId' },
          { detail: 'That render is not a finished draft of this timeline' },
        ),
      );
    // A pre-render QA stop records a render for this timeline with no video file yet; fall back to the
    // newest watchable draft (or reel-only before the first draft) rather than failing the comparison.
    if (got.value.filePath) return ok(got.value);
  }
  const listed = await deps.renders.list({ projectId: timeline.projectId });
  if (!listed.ok) return listed;
  const drafts = listed.value.filter(
    (render) =>
      render.timelineId === timeline.id &&
      render.filePath &&
      !render.deletedAt &&
      WATCHABLE.has(render.status),
  );
  return ok(drafts.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null);
}

/** The timeline as the draft shows it. */
async function draftedTimeline(
  deps: EyesDeps,
  timeline: Timeline,
  revision: number,
): Promise<Timeline | null> {
  if (revision === timeline.revision) return timeline;
  const at = deps.timelines.atRevision ? await deps.timelines.atRevision(timeline.id, revision) : null;
  return at?.ok ? at.value : null;
}

async function keep(ctx: ToolContextBase, data: Buffer | null, summary: string): Promise<string | null> {
  if (!data) return null;
  const stored = await ctx.artifacts.put({ mediaType: 'image/jpeg', data, summary });
  return stored.ok ? stored.value.id : null;
}

/** Each row's two stills, cut and kept as artifacts; a still FFmpeg can't cut is null. */
async function cutRows(
  media: MediaContext,
  files: { readonly reel: string | null; readonly draft: RenderRecord | null },
  rows: readonly PlannedRow[],
  longSide: number,
  ctx: ToolContextBase,
): Promise<Cut[]> {
  const still = async (path: string | null, seconds: number | null) => {
    if (!path || seconds === null) return null;
    const cut = await stillAt(media, path, seconds, longSide, ctx.signal);
    return cut.ok ? cut.value.data : null;
  };
  const cuts: Cut[] = [];
  for (const row of rows) {
    const reel = await still(files.reel, row.reelSeconds);
    const draft = await still(files.draft?.filePath ?? null, row.draftSeconds);
    const where = `slot ${row.slot}, ${row.moment}`;
    cuts.push({
      row,
      reel,
      draft,
      reelImage: await keep(ctx, reel, `The reel, ${where}, ${row.reelSeconds} s in.`),
      draftImage: await keep(ctx, draft, `Draft ${files.draft?.id}, ${where}, ${row.draftSeconds} s in.`),
    });
  }
  return cuts;
}

/** The sheets: rows of [reel, draft] cells (the columns there are), at most COMPARE_SHEETS_MAX. */
async function sheetsOf(
  media: MediaContext,
  dir: string,
  cuts: readonly Cut[],
  columns: readonly ('reel' | 'draft')[],
  cell: CellSize,
  ctx: ToolContextBase,
): Promise<CompareOutput['sheets']> {
  if (columns.length === 0) return [];
  await mkdir(dir, { recursive: true });
  const sheets: CompareOutput['sheets'] = [];
  for (let start = 0; start < cuts.length && sheets.length < COMPARE_SHEETS_MAX; start += ROWS_PER_SHEET) {
    const part = cuts.slice(start, start + ROWS_PER_SHEET);
    const cells = part.map((cut) => columns.map((column) => (column === 'reel' ? cut.reel : cut.draft)));
    const sheet = await sheetOf(media, dir, cells, cell, ctx.signal);
    if (!sheet.ok) continue;
    const slots = [...new Set(part.map((cut) => cut.row.slot))];
    const stored = await ctx.artifacts.put({
      mediaType: 'image/jpeg',
      data: sheet.value.data,
      summary: `Compare sheet, slots ${slots.join(', ')}: ${columns.join(' | ')}, one row per slot moment.`,
    });
    if (!stored.ok) continue;
    sheets.push({
      image: stored.value,
      columns: [...columns],
      rows: part.map((cut) => ({ slot: cut.row.slot, moment: cut.row.moment })),
    });
  }
  return sheets;
}

function slotOut(slot: PlannedSlot, cuts: readonly Cut[]): CompareSlot {
  return {
    ...slot.facts,
    slotId: slot.slotId,
    clip: slot.now?.clip ?? null,
    clipId: slot.now?.clipId ?? null,
    draft:
      slot.drafted?.kind === 'clip'
        ? { at: round(slot.drafted.at), seconds: round(slot.drafted.seconds) }
        : null,
    frames: cuts
      .filter((cut) => cut.row.slotId === slot.slotId)
      .map((cut) => ({
        moment: cut.row.moment,
        reelSeconds: cut.row.reelSeconds,
        draftSeconds: cut.row.draftSeconds,
        reelImage: cut.reelImage,
        draftImage: cut.draftImage,
      })),
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

interface NoteFacts {
  readonly columns: readonly ('reel' | 'draft')[];
  readonly pictures: FootagePicturesOut;
  readonly draft: RenderRecord | null;
  readonly timeline: Timeline;
  readonly reel: boolean;
  readonly media: boolean;
  readonly left: readonly number[];
}

function noteOf(facts: NoteFacts): string {
  const lines: string[] = [];
  if (facts.columns.length > 0)
    lines.push(
      `Each sheet has one row per slot moment, top to bottom as its rows say: ${facts.columns.join(' on the left, ')}${facts.columns.length > 1 ? ' on the right' : ''}.`,
    );
  if (!facts.media) lines.push('No frames: FFmpeg is not available here. The slots’ facts are below.');
  if (!facts.reel) lines.push('The template keeps no reel, so there are no reel frames.');
  if (!facts.draft)
    lines.push('No draft yet: render.draft makes one. The reel’s frames and the slots’ facts are here.');
  else if (facts.draft.timelineRevision !== facts.timeline.revision)
    lines.push(
      `The draft shows revision ${facts.draft.timelineRevision}; the timeline is at ${facts.timeline.revision}: render.draft again to see the newest.`,
    );
  if (facts.draft && facts.pictures.footage === 'kept')
    lines.push(`The draft’s frames are not shown: ${facts.pictures.why}`);
  if (facts.left.length > 0)
    lines.push(`Not compared here: slots ${facts.left.join(', ')}. Ask for them in another call.`);
  return lines.join(' ');
}

export function videoCompareTool(deps: EyesDeps): AnyTool {
  return defineTool({
    name: 'video.compare',
    version: '1.0.0',
    description:
      'Shows the newest draft next to the reel its template came from, slot by slot: the reel’s frame and the ' +
      'draft’s at the same point of each slot (start, middle, end), as pictures with one row per slot moment, the ' +
      'reel left and the draft right. With each slot’s facts: what it should show (intent, needs, face, shot type, ' +
      'camera move, people), where it sits in the reel and in the draft, the clip filling it now and the cast’s ' +
      `score. Each frame is also an image artifact. At most ${COMPARE_ROWS_MAX} slot moments a call. judge asks a ` +
      'vision judge what differs in each slot. The draft’s frames are shown where the person’s video may go to ' +
      'the model (pictures says which).',
    summary: 'Shows the newest draft next to the reel, slot by slot, as pictures with each slot’s facts.',
    tags: ['compare', 'reel', 'draft', 'frames', 'look', 'review', 'template', 'slots', 'image'],
    input: compareInputSchema,
    output: compareOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 180_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library', 'project', 'app-data'] }, network: 'none' },
    images: (output) => output.sheets.map((sheet) => sheet.image as ArtifactRef),
    summarize: (output) =>
      `${output.slots.length} slots compared${output.draft ? ` with draft ${output.draft.renderId}` : ', no draft yet'}; ` +
      `${output.sheets.length} pictures; the draft's frames ${output.pictures.footage}`,
    describeCall: (_input, output) => `${output.slots.length} slots`,
    run: (input, ctx) => compare(deps, input, ctx),
  }) as AnyTool;
}

async function compare(
  deps: EyesDeps,
  input: CompareInput,
  ctx: ToolContextBase,
): AsyncResult<CompareOutput> {
  const latest = await deps.timelines.get(input.timelineId as Timeline['id']);
  if (!latest.ok) return latest;
  const timeline = latest.value;
  if (!timeline.template)
    return err(
      ValidationError(
        { field: 'timelineId' },
        { detail: 'This timeline was not made from a template: there is no reel to compare with' },
      ),
    );
  const template = await deps.templates.read(timeline.template);
  if (!template.ok) return template;
  const now = slotPlacesOf(timeline);
  const facts = slotFactsOf(
    timeline,
    template.value,
    new Map([...now].map(([slot, place]) => [slot, place.clipId])),
  );
  const draft = await draftOf(deps, timeline, input.renderId);
  if (!draft.ok) return draft;
  const record = draft.value;
  const drafted = record ? await draftedTimeline(deps, timeline, record.timelineRevision) : null;
  const media = await deps.media().catch(() => null);
  const reel = media ? await deps.reel(template.value.id).catch(() => null) : null;
  const pictures = await footageVerdict(deps.pictures, ctx.signal);
  const plan = planCompare({
    template: template.value,
    facts,
    now,
    drafted: drafted ? slotPlacesOf(drafted) : null,
    reelLength: reel ? RationalTime.toSeconds(template.value.duration) : null,
    draftLength: record && media ? (record.durationFrames * record.rate.den) / record.rate.num : null,
    ...(input.slots ? { slots: input.slots } : {}),
    ...(input.moments ? { moments: input.moments } : {}),
  });
  const cell = cellOf(template.value.canvas, input.cellHeight);
  const cuts = media
    ? await cutRows(media, { reel, draft: record }, plan.rows, Math.max(cell.width, cell.height), ctx)
    : [];
  const columns = [
    ...(reel ? (['reel'] as const) : []),
    ...(record && media && pictures.footage === 'shown' ? (['draft'] as const) : []),
  ];
  const sheets = media ? await sheetsOf(media, deps.scratch, cuts, columns, cell, ctx) : [];
  const slots = plan.slots.map((slot) => slotOut(slot, cuts));
  const judged = input.judge ? await judgeSlots(deps, plan.slots, cuts, pictures, ctx.signal) : new Map();
  return ok({
    timelineId: timeline.id,
    draft: record
      ? {
          renderId: record.id,
          revision: record.timelineRevision,
          newest: record.timelineRevision === timeline.revision,
        }
      : null,
    reel: reel !== null,
    pictures,
    sheets,
    slots: slots.map((slot) =>
      judged.has(slot.slotId) ? { ...slot, judged: judged.get(slot.slotId) } : slot,
    ),
    left: [...plan.left],
    note: noteOf({
      columns,
      pictures,
      draft: record,
      timeline,
      reel: reel !== null,
      media: media !== null,
      left: plan.left,
    }),
  });
}
