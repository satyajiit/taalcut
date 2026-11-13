// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 (tpl): the make's frame checks. Each composition a made timeline's graphics draw with is drawn over the
 * footage where each of its graphics plays (the render worker's `workspaceFrames`, settled after its entrance and in
 * its middle), with that graphic's own words, and held to: the render's frame checks (on the canvas, the type floor,
 * contrast), the graphics' safe rect, and the people's heads (FRM1's subject tracks). A composition lays itself out,
 * so a failure is never fixed by a solver's box or a kit: it goes back to the Designer with the frames that show it,
 * and the new design is checked again over every graphic that draws with it, up to `rounds`. What comes back is a
 * redesign per composition for `graphics.setComposition`, and what still fails.
 */
import {
  compositionFor,
  RationalTime,
  type AsyncResult,
  type Box,
  type GraphicComposition,
  type GraphicItem,
  type ProjectId,
  type Timeline,
  type TimelineItemId,
  type WorkspaceFramesInput,
  type WorkspaceFramesOutput,
} from '@taalcut/core';
import type { CompositionBrief } from '../template/brief';
import { briefMarkdown } from '../template/brief-text';
import type { DesignFeedback, DesignOverlay, DesignPicture } from '../template/designer';

export interface FillCheckDeps {
  readonly projectId: ProjectId;
  readonly frames: (input: WorkspaceFramesInput, signal?: AbortSignal) => AsyncResult<WorkspaceFramesOutput>;
  /** Heads round a timeline frame and the graphics' safe rect, as canvas shares (timeline's `checkSceneOf`). */
  readonly scene: { heads(frame: number): readonly Box[]; readonly safe: Box };
  /** The Designer, and the template's brief a composition was designed from; without them nothing is redesigned. */
  readonly design?: DesignOverlay;
  readonly briefFor?: (
    composition: GraphicComposition,
    items: readonly GraphicItem[],
  ) => CompositionBrief | null;
  readonly rounds?: number;
  readonly signal?: AbortSignal;
}

export interface FillFinding {
  readonly itemId: TimelineItemId;
  /** The render's check id, or `safeRect` / `face`. */
  readonly check: string;
  /** What failed and how to fix it, for the Designer and the log. */
  readonly detail: string;
}

export interface FillRedesign {
  readonly itemIds: readonly TimelineItemId[];
  /** The next version of the composition (same id), which passed the gate and these checks or the last round. */
  readonly composition: GraphicComposition;
}

export interface FillCheckResult {
  readonly redesigns: readonly FillRedesign[];
  /** What still fails after the last round (or with no Designer). */
  readonly findings: readonly FillFinding[];
  /** Graphics checked. */
  readonly checked: number;
}

export const FILL_CHECK_ROUNDS = 2;
/** A box may pass the safe rect's edge by this share of the canvas (antialiasing, shadows). */
const SAFE_SLACK = 0.004;

const seconds = (time: RationalTime) => RationalTime.toSeconds(time);
const percent = (share: number) => `${Math.round(share * 100)}%`;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The moments drawn: settled after its entrance, and its middle (seconds into the composition). */
export function fillMoments(item: GraphicItem, composition: GraphicComposition): number[] {
  const length = Math.min(seconds(item.duration), composition.durationSeconds);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [...new Set([round(Math.min(0.5, length / 4)), round(length / 2)])];
}

interface Drawn {
  readonly item: GraphicItem;
  readonly findings: FillFinding[];
  readonly pictures: { readonly label: string; readonly picture: DesignPicture }[];
}

/** One graphic drawn with `composition` over its footage, and what its frames fail. */
async function drawOne(
  timeline: Timeline,
  item: GraphicItem,
  composition: GraphicComposition,
  deps: FillCheckDeps,
): Promise<Drawn> {
  const at = fillMoments(item, composition);
  const start = seconds(item.start);
  const findings: FillFinding[] = [];
  const drawn = await deps.frames(
    {
      projectId: deps.projectId,
      entry: composition.entry,
      files: composition.files,
      params: item.composition.params,
      seconds: at,
      over: { kind: 'footage', timelineId: timeline.id, timelineRevision: timeline.revision, start },
    },
    deps.signal,
  );
  if (!drawn.ok) {
    findings.push({
      itemId: item.id,
      check: 'frames',
      detail: `It could not be drawn (${drawn.error.code})`,
    });
    return { item, findings, pictures: [] };
  }
  for (const check of drawn.value.checks)
    if (check.status === 'fail')
      findings.push({ itemId: item.id, check: check.id, detail: check.detail ?? `${check.id} failed` });
  const fps = timeline.canvas.rate.num / timeline.canvas.rate.den;
  const { safe } = deps.scene;
  const pictures: Drawn['pictures'] = [];
  drawn.value.frames.forEach((frame, index) => {
    const when = `${(start + (at[index] ?? 0)).toFixed(2)} s into the video`;
    pictures.push({
      label: `your design over the made video's footage, ${when}`,
      picture: { data: frame.dataBase64, mimeType: frame.mimeType },
    });
    const box = frame.box;
    if (!box) return;
    if (
      box.x < safe.x - SAFE_SLACK ||
      box.y < safe.y - SAFE_SLACK ||
      box.x + box.width > safe.x + safe.width + SAFE_SLACK ||
      box.y + box.height > safe.y + safe.height + SAFE_SLACK
    )
      findings.push({
        itemId: item.id,
        check: 'safeRect',
        detail:
          `At ${when} it reaches outside the safe area (it spans x ${percent(box.x)}–${percent(box.x + box.width)}, ` +
          `y ${percent(box.y)}–${percent(box.y + box.height)}; the safe area is x ${percent(safe.x)}–${percent(safe.x + safe.width)}, ` +
          `y ${percent(safe.y)}–${percent(safe.y + safe.height)}). Keep it inside, with max-width rather than a smaller design.`,
      });
    const frameAt = Math.round((start + (at[index] ?? 0)) * fps);
    const head = deps.scene.heads(frameAt).find((candidate) => overlaps(box, candidate));
    if (head)
      findings.push({
        itemId: item.id,
        check: 'face',
        detail:
          `At ${when} it covers a person's head (x ${percent(head.x)}–${percent(head.x + head.width)}, ` +
          `y ${percent(head.y)}–${percent(head.y + head.height)} of the frame). Move it clear of the head, to the open side, keeping its look.`,
      });
  });
  return { item, findings, pictures };
}

/** The first text variable's name: where every graphic keeps its words. */
const wordsVariable = (composition: GraphicComposition) =>
  composition.variables.find((variable) => variable.type === 'text')?.name;

/** The made video's failures in the Designer's words, with the frames that show them. */
function feedbackOf(previous: GraphicComposition, failed: readonly Drawn[]): DesignFeedback {
  const lines = failed.flatMap((entry) => entry.findings.map((finding) => `- ${finding.detail}`));
  return {
    previous,
    reason:
      `Over a made video's footage, with its own words, the design fails these checks:\n${[...new Set(lines)].join('\n')}\n` +
      `Keep its variables and their names: each graphic keeps its own words in "${wordsVariable(previous) ?? 'text'}".`,
    frames: failed.flatMap((entry) => entry.pictures).slice(0, 6),
  };
}

export async function checkFills(timeline: Timeline, deps: FillCheckDeps): Promise<FillCheckResult> {
  const graphics = timeline.tracks.flatMap((track) =>
    track.kind === 'text' && track.enabled
      ? track.items.filter((item): item is GraphicItem => item.type === 'graphic' && !item.proposal)
      : [],
  );
  const groups = new Map<string, { composition: GraphicComposition; items: GraphicItem[] }>();
  for (const item of graphics) {
    const composition = compositionFor(item.composition, timeline.graphicCompositions);
    if (!composition) continue;
    const key = `${composition.id}@${composition.hash}`;
    groups.set(key, { composition, items: [...(groups.get(key)?.items ?? []), item] });
  }
  const redesigns: FillRedesign[] = [];
  const findings: FillFinding[] = [];
  const rounds = deps.rounds ?? FILL_CHECK_ROUNDS;
  for (const { composition: first, items } of groups.values()) {
    let composition = first;
    let failed: Drawn[] = [];
    for (let round = 0; round <= rounds && !deps.signal?.aborted; round++) {
      const drawn: Drawn[] = [];
      for (const item of items) drawn.push(await drawOne(timeline, item, composition, deps));
      failed = drawn.filter((entry) => entry.findings.length > 0);
      if (failed.length === 0 || round === rounds) break;
      const brief = deps.briefFor?.(composition, items) ?? null;
      if (!deps.design || !brief) break;
      const answer = await deps.design(
        {
          projectId: deps.projectId,
          brief,
          markdown: briefMarkdown(brief),
          reel: [],
          feedback: feedbackOf(composition, failed),
        },
        deps.signal,
      );
      if (!answer.ok || 'reason' in answer.value || !answer.value.designed.composition.gate.passed) break;
      // A redesign that moved the words to another variable would draw its sample, not the graphics' own words.
      if (wordsVariable(answer.value.designed.composition) !== wordsVariable(composition)) break;
      // The next version of the same graphic: every graphic drawn with it moves to it (graphics.setComposition).
      composition = { ...answer.value.designed.composition, id: first.id, version: composition.version + 1 };
    }
    if (composition !== first) redesigns.push({ itemIds: items.map((item) => item.id), composition });
    findings.push(...failed.flatMap((entry) => entry.findings));
  }
  return { redesigns, findings, checked: graphics.length };
}
