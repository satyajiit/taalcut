// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One template case through the app's template path (HFW1 tpl): its made-up reel read as a template
 * (template-reel.ts), its graphics designed by render's `designTemplateCompositions` with the template Designer
 * (render's `templateDesigner`, the loop the app runs, here without the desktop container: a workspace over a scratch
 * folder, the workspace commands on a real bus, artifacts in memory, the stills from `frames`), one round, no judge.
 * It passes when every brief ends in design.done, every composition passes the gate (again, from its stored files),
 * and each overlay's design, drawn with its own words over the reel's frame from just before it came on at the
 * reel's middle moment, sits where the reel's did, as big, on as many lines (TEMPLATE_TOLERANCES).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  err,
  newId,
  NotFoundError,
  ok,
  type CommandOrigin,
  type CompositionGateCheck,
  type GraphicComposition,
  type ProjectId,
  type TextOverlay,
} from '@taalcut/core';
import {
  compositionBriefs,
  designTemplateCompositions,
  gateComposition,
  reelMatch,
  templateDesigner,
  type DesignerLoopResult,
  type DesignerModel,
  type DesignPicture,
} from '@taalcut/render';
import type { ReelOverlay, TemplateCase } from './template-cases';
import { makeReel, type Measured } from './template-reel';
import { diskWorkspace } from './workspace';
import { memoryArtifacts, type FramesFn } from './world';

/**
 * How close a design must sit to the reel's: its middle within 3 % of the canvas, each side within 15 %. A reel of
 * another shape (16:9) is compared by shares of each frame: the edge it hangs from and its middle down within 3 %, its
 * shape's aspect in pixels within 15 % of the reel's, and its words over the type floor.
 */
export const TEMPLATE_TOLERANCES = { position: 0.03, size: 0.15, aspect: 0.15 } as const;
const FPS = 30;
const AGENT: CommandOrigin = { source: 'agent', actor: 'agent:eval-design-template' };

export interface OverlayCheck {
  readonly fixture: string;
  readonly reel: Measured;
  readonly design: Measured;
  /** The middles' distance across and down, and each side's ratio to the reel's (1 is the same). */
  readonly dx: number | null;
  readonly dy: number | null;
  readonly width: number | null;
  readonly height: number | null;
  /** A reel of another shape: the design's shape's aspect (width over height, in pixels) over the reel's. */
  readonly aspect?: number | null;
  /** The template Designer's own reel-match check on the design's still, where the case holds it to it. */
  readonly reelMatch?: CompositionGateCheck['status'];
  /** The render's own frame checks that failed on the design's still (bounds, typeFloor, contrast). */
  readonly frameChecks: readonly string[];
  readonly why: string | null;
}

export interface BriefOutcome {
  readonly role: string;
  readonly overlays: number;
  readonly designed: boolean;
  readonly gatePassed: boolean;
  readonly reason: string | null;
  readonly turns: number;
  readonly stopped: DesignerLoopResult['stopped'] | null;
  readonly renders: number;
  readonly refusals: readonly string[];
  /** Every call: its tool, and a refusal's code. */
  readonly calls: readonly string[];
  /** The type size it was asked to share with its conversation's bubble designed before it (none: it led). */
  readonly threadFontPx: number | null;
}

export interface TemplateCaseOutcome {
  readonly id: string;
  readonly about: string;
  readonly pass: boolean;
  readonly why: string | null;
  readonly briefs: readonly BriefOutcome[];
  readonly checks: readonly OverlayCheck[];
  /** The design's minutes (the reel's drawing is the eval's, not counted). */
  readonly minutes: number;
  readonly stills: readonly string[];
}

export interface TemplateCaseDeps {
  readonly root: string;
  readonly frames: FramesFn;
  readonly footage: DesignPicture;
  /** A drawn still cut to a reel of another shape's band (template-reel.ts); none: nothing is cut. */
  readonly crop?: (picture: DesignPicture, height: number) => Promise<DesignPicture>;
  /** The Designer's model for this case's template overlays. */
  readonly model: (overlays: ReadonlyMap<TextOverlay['id'], ReelOverlay>) => DesignerModel;
  /** Where the case's stills go; none written without it. */
  readonly out?: string;
  readonly designerId?: string;
  /** Whether that model runs on this Mac (the 9B), for the compositions' provenance. */
  readonly onDevice?: boolean;
}

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** The design measured against the reel's, by TEMPLATE_TOLERANCES. */
export function compareToReel(
  fixture: string,
  reel: Measured,
  design: Measured,
  frameChecks: readonly string[] = [],
): OverlayCheck {
  const base = { fixture, reel, design, frameChecks };
  if (!reel.box)
    return {
      ...base,
      dx: null,
      dy: null,
      width: null,
      height: null,
      why: "the reel's draw measured nothing",
    };
  if (!design.box)
    return { ...base, dx: null, dy: null, width: null, height: null, why: 'the design draws nothing there' };
  const dx = round(Math.abs(design.box.x + design.box.width / 2 - (reel.box.x + reel.box.width / 2)));
  const dy = round(Math.abs(design.box.y + design.box.height / 2 - (reel.box.y + reel.box.height / 2)));
  const width = round(design.box.width / reel.box.width, 2);
  const height = round(design.box.height / reel.box.height, 2);
  const { position, size } = TEMPLATE_TOLERANCES;
  const why =
    dx > position || dy > position
      ? `its middle is ${Math.round(dx * 100)} % across and ${Math.round(dy * 100)} % down from the reel's`
      : Math.abs(width - 1) > size || Math.abs(height - 1) > size
        ? `it is ×${width} as wide and ×${height} as tall as the reel's`
        : design.lines !== reel.lines
          ? `its words are on ${design.lines ?? '?'} lines, the reel's on ${reel.lines ?? '?'}`
          : null;
  return { ...base, dx, dy, width, height, why };
}

type Side = 'left' | 'right' | 'centre';
const sideOf = (overlay: ReelOverlay): Side =>
  overlay.design.tail === 'left' || overlay.design.tail === 'right' ? overlay.design.tail : 'centre';

/** A design on the 9:16 canvas against a reel of another shape (its top `reelHeight` px), by TEMPLATE_TOLERANCES. */
export function compareWide(
  fixture: string,
  reel: Measured,
  design: Measured,
  frameChecks: readonly string[],
  reelHeight: number,
  side: Side,
): OverlayCheck {
  const base = { fixture, reel, design, frameChecks, width: null, height: null };
  if (!reel.box)
    return { ...base, dx: null, dy: null, aspect: null, why: "the reel's draw measured nothing" };
  if (!design.box)
    return { ...base, dx: null, dy: null, aspect: null, why: 'the design draws nothing there' };
  type Shares = NonNullable<Measured['box']>;
  const across = (box: Shares) =>
    side === 'left' ? box.x : side === 'right' ? box.x + box.width : box.x + box.width / 2;
  const dx = round(Math.abs(across(design.box) - across(reel.box)));
  const dy = round(Math.abs(design.box.y + design.box.height / 2 - (reel.box.y + reel.box.height / 2)));
  const pixels = (box: Shares, height: number) => (box.width * 1080) / (box.height * height);
  const aspect = round(pixels(design.box, 1920) / pixels(reel.box, reelHeight), 2);
  const why =
    dx > TEMPLATE_TOLERANCES.position || dy > TEMPLATE_TOLERANCES.position
      ? `its ${side === 'centre' ? 'middle' : `${side} edge`} is ${Math.round(dx * 100)} % across and ` +
        `${Math.round(dy * 100)} % down from the reel's`
      : Math.abs(aspect - 1) > TEMPLATE_TOLERANCES.aspect
        ? `its shape is ×${aspect} as wide for its height as the reel's`
        : frameChecks.includes('typeFloor')
          ? 'its words are under the type floor (typeFloor)'
          : null;
  return { ...base, dx, dy, aspect, why };
}

async function regate(
  store: ReturnType<typeof diskWorkspace>['store'],
  projectId: ProjectId,
  composition: GraphicComposition,
) {
  const files = [];
  for (const file of composition.files) {
    const data = await store.readBlob(projectId, file.sha256);
    if (!data.ok) return false;
    files.push({ ...file, text: new TextDecoder().decode(data.value) });
  }
  return (await gateComposition({ entry: composition.entry, files })).gate.passed;
}

const callWords = (loop: DesignerLoopResult) =>
  loop.calls.map((call) => (call.ok ? call.name : `${call.name}!${call.code ?? ''}`));
const findingCodes = (output: unknown) => {
  const result = output as { passed?: boolean; findings?: { code?: string }[] } | undefined;
  return result?.passed === false
    ? (result.findings ?? []).flatMap((finding) => (finding.code ? [finding.code] : []))
    : [];
};

export async function runTemplateCase(
  entry: TemplateCase,
  deps: TemplateCaseDeps,
): Promise<TemplateCaseOutcome> {
  const workspace = diskWorkspace(deps.root);
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
  bus.register(...workspace.commands);
  const dispatch = async (command: string, payload: unknown) => {
    const done = await bus.dispatch(command, payload, AGENT);
    return done.ok ? ok(done.value.result) : done;
  };
  const reel = await makeReel(entry, {
    frames: deps.frames,
    store: workspace.store,
    footage: deps.footage,
    ...(deps.crop ? { crop: deps.crop } : {}),
  });
  const projectId = newId<'Project'>() as ProjectId;
  const loops = new Map<string, DesignerLoopResult>();
  const threads = new Map<string, number>();
  const design = templateDesigner({
    model: deps.model(reel.overlays),
    workspace: {
      store: workspace.store,
      timelines: {
        get: async (id) => err(NotFoundError({ entity: 'timeline', id })),
        update: async (id) => err(NotFoundError({ entity: 'timeline', id })),
      },
      frames: deps.frames,
      designer: async () => ({
        id: deps.designerId ?? 'eval/designer',
        onDevice: deps.onDevice ?? false,
      }),
    },
    dispatch,
    artifacts: memoryArtifacts(),
    onLoop: (job, loop) => {
      loops.set(job.brief.role, loop);
      if (job.brief.thread) threads.set(job.brief.role, job.brief.thread.type.fontPx);
    },
  });
  const started = Date.now();
  const designed = await designTemplateCompositions(reel.template, {
    projectId,
    design,
    reelFrames: (brief) => reel.frames(brief),
    keep: async () => ok(undefined),
    rounds: 1,
  });
  const minutes = round((Date.now() - started) / 60_000, 1);
  const briefs: BriefOutcome[] = [];
  for (const outcome of designed.outcomes) {
    const loop = loops.get(outcome.role);
    briefs.push({
      role: outcome.role,
      overlays: outcome.overlays.length,
      designed: outcome.composition !== null,
      gatePassed:
        outcome.composition !== null &&
        outcome.composition.gate.passed &&
        (await regate(workspace.store, projectId, outcome.composition)),
      reason: outcome.reason,
      turns: loop?.turns ?? 0,
      stopped: loop?.stopped ?? null,
      renders: loop?.calls.filter((call) => call.ok && call.name.startsWith('workspace.render')).length ?? 0,
      refusals:
        loop?.calls.flatMap((call) => [
          ...(!call.ok && call.code ? [call.code] : []),
          ...findingCodes(call.output),
        ]) ?? [],
      calls: loop ? callWords(loop) : [],
      threadFontPx: threads.get(outcome.role) ?? null,
    });
  }
  const checks: OverlayCheck[] = [];
  const stills: string[] = [];
  const overlayBriefs = compositionBriefs(reel.template).flatMap((brief) => brief.overlays);
  const folder = deps.out ? join(deps.out, entry.id) : null;
  if (folder) await mkdir(folder, { recursive: true });
  for (const overlay of reel.template.text) {
    const source = reel.overlays.get(overlay.id)!;
    const use = designed.graphics.uses.find((candidate) => candidate.overlayId === overlay.id);
    const composition = designed.graphics.compositions?.find(
      (candidate) => candidate.id === use?.compositionId,
    );
    const reelMeasured = reel.measured.get(overlay.id)!;
    const compare = (design: Measured, failed: readonly string[]) =>
      entry.reelHeight
        ? compareWide(source.fixture, reelMeasured, design, failed, entry.reelHeight, sideOf(source))
        : compareToReel(source.fixture, reelMeasured, design, failed);
    if (!use || !composition) {
      checks.push(compare({ box: null, lines: null }, []));
      continue;
    }
    const appears = source.startFrame / FPS;
    const middle = (source.startFrame + source.frames / 2) / FPS;
    const before = await reel.pictureAt(Math.max(0, appears - 1 / FPS));
    const at = round(Math.min(composition.durationSeconds - 1 / FPS, Math.max(0, middle - appears)));
    const drawn = await deps.frames(
      {
        projectId,
        entry: composition.entry,
        files: composition.files,
        params: use.params,
        seconds: [at],
        over: { kind: 'image', mimeType: before.mimeType, dataBase64: before.data },
        maxDimension: 768,
      },
      { signal: new AbortController().signal },
    );
    const frame = drawn.ok ? drawn.value.frames[0] : undefined;
    const failed = drawn.ok
      ? drawn.value.checks.filter((check) => check.status === 'fail').map((check) => check.id)
      : ['frames'];
    const compared = compare({ box: frame?.box ?? null, lines: frame?.lines ?? null }, failed);
    // Drawn with its own words (the reel's), as the Designer's reelMatch holds it to the brief's place.
    const briefed = overlayBriefs.find((candidate) => candidate.overlayId === overlay.id);
    const match = entry.reelMatch && briefed ? reelMatch(briefed, frame?.box ?? null) : null;
    checks.push(
      match
        ? {
            ...compared,
            reelMatch: match.status,
            why:
              compared.why ?? (match.status === 'fail' ? `reelMatch: ${match.detail ?? 'it fails'}` : null),
          }
        : compared,
    );
    if (folder && frame) {
      const reelStill = await reel.pictureAt(middle);
      const reelFile = join(folder, `${source.fixture}-reel.jpg`);
      const designFile = join(folder, `${source.fixture}-design.jpg`);
      await writeFile(reelFile, Buffer.from(reelStill.data, 'base64'));
      await writeFile(designFile, Buffer.from(frame.dataBase64, 'base64'));
      stills.push(reelFile, designFile);
    }
  }
  const undesigned = briefs.find((brief) => !brief.designed);
  const ungated = briefs.find((brief) => brief.designed && !brief.gatePassed);
  const off = checks.find((check) => check.why !== null);
  const why = undesigned
    ? `${undesigned.role}: no design.done (${undesigned.reason ?? undesigned.stopped ?? 'none'})`
    : ungated
      ? `${ungated.role}: its composition does not pass the gate`
      : off
        ? `${off.fixture}: ${off.why}`
        : null;
  return { id: entry.id, about: entry.about, pass: why === null, why, briefs, checks, minutes, stills };
}
