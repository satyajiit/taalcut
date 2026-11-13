// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: render's slot-match checks (slotMatchFact, slotMatchChecks) on a timeline with no pixels, for eval:make's
 * draft and the owner check outside the repo. What the export would measure is worked out from the timeline: each V1
 * clip's output frames from its place on V1; its people from the subject tracks over its source range, onto the
 * canvas as render frames it (planVisualFraming): no reframe shows the source's cover window in the middle; a reframe
 * shows the cover window shrunk by its scale, on the followed head ('auto', 'subject') or on the middle ('centre'),
 * moved by its nudge; 'blurPad' and contain show it all. Heads are timeline's `headsOf` (a track's own, else stood in
 * from faces and bodies), as render's heads stage reads them. A face shows by timeline's `showsFace`; a graphic's box
 * is its placement's (a named band: the middle 80 % at its height). The shots' word is timeline's `slotShots`.
 */
import {
  RationalTime,
  type Clip,
  type Embedder,
  type GraphicItem,
  type QaCheckResult,
  type Rect,
  type ShotProfileSource,
  type SubjectSource,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { slotMatchChecks, slotMatchFact, type ClipHeads, type SlotMatchFact } from '@taalcut/render';
import { CASTING_CONFIG, headsOf as sampleHeads, showsFace, slotShots } from '@taalcut/timeline';

export interface MeasureDeps {
  readonly subjects: SubjectSource;
  readonly profiles: Pick<ShotProfileSource, 'profiles'>;
  readonly embedder?: Embedder;
}

const meanSpeed = (clip: Clip) =>
  clip.speed ? clip.speed.points.reduce((sum, point) => sum + point.speed, 0) / clip.speed.points.length : 1;

type Window = Rect;

/** The source's middle window at the canvas's aspect (render's coverWindow). */
function coverWindow(sourceAspect: number, canvasAspect: number): Window {
  const width = sourceAspect > canvasAspect ? canvasAspect / sourceAspect : 1;
  const height = sourceAspect > canvasAspect ? 1 : sourceAspect / canvasAspect;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/** What of the source a clip shows (see the file's note). */
function windowOf(clip: Clip, head: Rect | null, sourceAspect: number, canvasAspect: number): Window {
  const reframe = clip.reframe;
  if (clip.fit === 'contain' || reframe?.mode === 'blurPad') return { x: 0, y: 0, width: 1, height: 1 };
  const cover = coverWindow(sourceAspect, canvasAspect);
  if (!reframe) return cover;
  const width = cover.width / reframe.scale;
  const height = cover.height / reframe.scale;
  const follow = reframe.mode !== 'centre' && head;
  const cx = (follow ? head.x + head.width / 2 : 0.5) + reframe.nudge.x * width;
  const cy = (follow ? head.y + head.height / 2 : 0.5) + reframe.nudge.y * height;
  const clamp = (centre: number, size: number) => Math.min(1 - size, Math.max(0, centre - size / 2));
  return { x: clamp(cx, width), y: clamp(cy, height), width, height };
}

const through = (box: Rect, window: Window, canvas: { width: number; height: number }): Rect => ({
  x: ((box.x - window.x) / window.width) * canvas.width,
  y: ((box.y - window.y) / window.height) * canvas.height,
  width: (box.width / window.width) * canvas.width,
  height: (box.height / window.height) * canvas.height,
});

interface Placed {
  readonly clip: Clip;
  readonly cut: { start: number; end: number };
}

function v1Clips(timeline: Timeline, fps: number): Placed[] {
  const v1 = timeline.tracks[0];
  if (v1?.kind !== 'video') return [];
  let at = 0;
  return v1.items.flatMap((item): Placed[] => {
    if (item.type === 'transition') return [];
    const frames = Math.round(RationalTime.toSeconds(item.duration) * fps);
    const cut = { start: at, end: at + frames };
    at += frames;
    return item.type === 'clip' && item.enabled && item.media.kind === 'video' ? [{ clip: item, cut }] : [];
  });
}

async function headsOf(placed: readonly Placed[], subjects: SubjectSource, timeline: Timeline, fps: number) {
  const canvas = timeline.canvas;
  const out: ClipHeads[] = [];
  for (const { clip, cut } of placed) {
    if (clip.media.kind !== 'video') continue;
    const speed = meanSpeed(clip);
    const from = RationalTime.toSeconds(clip.sourceStart);
    const seconds = ((cut.end - cut.start) / fps) * speed;
    const span = await subjects.over({
      assetId: clip.media.assetId,
      start: clip.sourceStart,
      end: RationalTime.fromSeconds(from + seconds, clip.sourceStart.rate, 'round'),
    });
    if (!span.ok || !span.value) continue;
    const frame = span.value.frame;
    const sourceAspect = frame ? frame.width / frame.height : canvas.width / canvas.height;
    // As render's heads stage: heads are on detect samples, so those are read when there are any.
    const all = span.value.samples;
    const measured = all.some((sample) => sample.heads !== undefined);
    const samples = measured ? all.filter((sample) => sample.heads !== undefined) : all;
    const at = (seconds: number) => cut.start + Math.round(((seconds - from) * fps) / speed);
    out.push({
      id: clip.id,
      cut,
      visible: cut,
      samples: samples.map((sample, index) => {
        const heads = sampleHeads(sample, 1 / sourceAspect);
        const window = windowOf(clip, heads[0] ?? null, sourceAspect, canvas.width / canvas.height);
        const next = samples[index + 1];
        return {
          frame: at(RationalTime.toSeconds(sample.t)),
          next: next ? at(RationalTime.toSeconds(next.t)) : at(RationalTime.toSeconds(sample.t)) + fps / 4,
          heads: heads.map((box) => through(box, window, canvas)),
          face: showsFace(sample.faces, CASTING_CONFIG.inPoint.subjects),
        };
      }),
    });
  }
  return out;
}

const graphicItems = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text'
      ? track.items.filter((item): item is GraphicItem => item.type === 'graphic' && !item.proposal)
      : [],
  );

function placedBox(item: GraphicItem, canvas: { width: number; height: number }): Rect {
  const band = { top: 0.08, middle: 0.47, bottom: 0.78 };
  const share =
    typeof item.placement === 'string'
      ? { x: 0.1, y: band[item.placement], width: 0.8, height: 0.06 }
      : item.placement.box;
  return {
    x: share.x * canvas.width,
    y: share.y * canvas.height,
    width: share.width * canvas.width,
    height: share.height * canvas.height,
  };
}

/** Render's slot facts and checks on the timeline as it is. */
export async function measureSlots(
  timeline: Timeline,
  template: Template,
  deps: MeasureDeps,
): Promise<{ readonly fact: SlotMatchFact; readonly checks: QaCheckResult[] }> {
  const rate = timeline.canvas.rate;
  const fps = rate.num / rate.den;
  const placed = v1Clips(timeline, fps);
  const heads = await headsOf(placed, deps.subjects, timeline, fps);
  const shots = await slotShots(timeline, template, {
    profiles: deps.profiles,
    ...(deps.embedder ? { embedder: deps.embedder } : {}),
  });
  const frames = (time: RationalTime) => Math.round(RationalTime.toSeconds(time) * fps);
  const graphics = graphicItems(timeline);
  const fact = slotMatchFact({
    timeline,
    template,
    shots: shots.ok ? shots.value : [],
    plan: {
      width: timeline.canvas.width,
      height: timeline.canvas.height,
      rate,
      visuals: placed.map(({ clip, cut }) => ({ id: clip.id, cut, enabled: true, slotId: clip.slotId })),
      compositions: graphics.map((item) => ({
        itemId: item.id,
        span: { start: frames(item.start), end: frames(item.start) + frames(item.duration) },
        values: item.composition.params,
      })),
    },
    heads,
  });
  const byId = new Map(graphics.map((item) => [item.id as string, item]));
  const checks = slotMatchChecks(fact, (itemId) => {
    const item = byId.get(itemId);
    return item ? placedBox(item, timeline.canvas) : null;
  });
  return { fact, checks };
}
