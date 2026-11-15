// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: a cover drawn from its composition. The composition is a workspace file like a video graphic's: it is
 * gated the same way, folded by the same layer and drawn in the same headless session, on a canvas the size of
 * the cover. Its pictures are by reference: each `<img data-picture>` gets the picture the cover states for its
 * name, read here from the original (a frame of the timeline with the video's own effects and none of its
 * titles, captions or graphics; or a library shot at a time), so no frame is ever a workspace file.
 *
 * Nothing here falls back: a composition that does not pass the gate, is not the cover's size, names a picture
 * the cover does not state, or whose picture cannot be read is refused with what to change.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  NotFoundError,
  ok,
  RationalTime,
  ValidationError,
  VIDEO_SIZES,
  type AsyncResult,
  type CompositionGateCheck,
  type CoverComposition,
  type CoverPicture,
  type CoverSettings,
  type Timeline,
} from '@taalcut/core';
import { createCompositionFonts } from '../captions/fonts';
import { compileComposition } from '../compile/composition';
import { writeBundle } from '../engine/bundle-writer';
import { captureFrame } from '../engine/capture-frame';
import type { RenderEngineDeps } from '../engine/deps';
import { openStillSession } from '../engine/still-session';
import { extractStill } from '../engine/stills';
import { canvasPreset } from '../presets/canvas-preset';
import { DEFAULT_PRESET_ID, presetFor } from '../presets/presets.v1';
import { placementsOf } from '../workspace/fold/placements';
import { workspaceReaderAt } from '../workspace/fold/reader';
import type { AssetLink } from '../workspace/fold/types';
import { CONTENT_PROBE, type ProbedContent } from '../workspace/frames/content-probe';
import { FRAMES_RATE, sceneTimeline } from '../workspace/frames/scene';
import { neutralPng } from '../workspace/frames/still';
import { gateComposition } from '../workspace/gate/workspace-gate';
import { walk, type MarkupNode } from '../workspace/html/markup';
import { coverChecks, coverFactsProbe, type CoverFacts } from './cover-checks';

const ITEM = 'COVER';
const PICTURES_DIR = 'pictures';

export interface ComposedCover {
  readonly jpeg: Buffer;
  readonly width: number;
  readonly height: number;
  /** What the drawn cover says of itself (cover-checks.ts). */
  readonly checks: CompositionGateCheck[];
}

interface Target {
  readonly projectId: Timeline['projectId'];
  readonly timelineId: Timeline['id'];
  readonly revision: number;
}

const refused = (detail: string) =>
  err(ValidationError({ field: 'cover.composition' }, { detail: detail.slice(0, 500) }));

/** The picture names the composition's images carry, in document order, each once. */
export function pictureNamesOf(root: MarkupNode): string[] {
  const names = new Set<string>();
  for (const node of walk([root])) {
    const name = node.tag === 'img' ? node.attributes['data-picture'] : undefined;
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/**
 * The timeline as its footage alone: no on-screen text, graphics or captions, so a cover's picture is the shot
 * (with its grade, framing and layout) and the cover's own lettering is the only lettering on it.
 */
function footageOnly(deps: RenderEngineDeps): RenderEngineDeps {
  return {
    ...deps,
    timelines: {
      ...deps.timelines,
      get: async (id) => {
        const found = await deps.timelines.get(id);
        if (!found.ok) return found;
        const tracks = found.value.tracks.filter((track) => track.kind !== 'text');
        return ok({ ...found.value, tracks, captions: null } as Timeline);
      },
    },
  };
}

/** One picture read from its original into `file` (a JPEG at most 1920 px on its longer side). */
async function resolvePicture(
  deps: RenderEngineDeps,
  target: Target,
  picture: CoverPicture,
  file: string,
  signal?: AbortSignal,
): AsyncResult<void> {
  if (picture.source.kind === 'frame') {
    const captured = await captureFrame(
      footageOnly(deps),
      {
        projectId: target.projectId,
        timelineId: target.timelineId,
        timelineRevision: target.revision,
        frame: picture.source.frame,
        source: { kind: 'preview' },
        original: true,
        maxDimension: 1920,
      },
      { signal },
    );
    if (!captured.ok) return captured;
    await writeFile(file, Buffer.from(captured.value.dataBase64, 'base64'));
    return ok(undefined);
  }
  const original = await deps.assets.original(picture.source.assetId);
  if (!original.ok) return original;
  if (!original.value) return err(NotFoundError({ entity: 'asset', id: picture.source.assetId }));
  return extractStill(deps.media, original.value.path, picture.source.seconds, file, signal);
}

/** Draws `cover` (which has a composition) at full size, in `work`. */
export async function drawComposedCover(
  deps: RenderEngineDeps,
  target: Target,
  cover: CoverSettings & { readonly composition: CoverComposition },
  work: string,
  signal?: AbortSignal,
): AsyncResult<ComposedCover> {
  const { composition } = cover;
  if (!deps.workspaceRoot) return refused('the workspace is not readable here');
  const reader = workspaceReaderAt(deps.workspaceRoot, target.projectId);
  const entry = composition.files.find((file) => file.path === composition.entry);
  const text = entry ? reader.text(entry.sha256) : undefined;
  if (!entry || text === undefined) return refused(`${composition.entry} is not in the workspace`);
  const gated = await gateComposition({
    entry: composition.entry,
    files: composition.files.map((file) => (file === entry ? { ...file, text } : file)),
  });
  if (!gated.gate.passed || !gated.prepared) {
    const first = gated.findings.find((finding) => finding.severity === 'error');
    return refused(
      `the composition does not pass the gate: ${first?.message ?? '?'}. ${first?.fixHint ?? ''}`,
    );
  }
  const { doc } = gated.prepared;
  const { width, height } = VIDEO_SIZES[cover.aspect];
  if (doc.width !== width || doc.height !== height)
    return refused(
      `the composition's root is ${doc.width}×${doc.height} and a ${cover.aspect} cover is ${width}×${height}. ` +
        `Set data-width="${width}" data-height="${height}" on the root and lay it out for that canvas.`,
    );
  const stated = new Map(composition.pictures.map((picture) => [picture.name, picture]));
  const used = pictureNamesOf(doc.root);
  const unknown = used.find((name) => !stated.has(name));
  if (unknown)
    return refused(
      `<img data-picture="${unknown}"> names a picture the cover does not state. State it in pictures ` +
        '(a frame of the video, or a library shot and a time), or remove the image.',
    );
  const idle = [...stated.keys()].find((name) => !used.includes(name));
  if (idle)
    return refused(
      `the picture "${idle}" is stated and no <img data-picture="${idle}"> draws it. Draw it, or leave it out.`,
    );

  const pictures: Record<string, AssetLink> = {};
  for (const [index, picture] of composition.pictures.entries()) {
    const file = join(work, `picture-${index}.jpg`);
    const resolved = await resolvePicture(deps, target, picture, file, signal);
    if (!resolved.ok) {
      // A frame past the end is the one thing a model gets wrong here: say which picture and what to give.
      const late = resolved.error.code === 'core.validation' && resolved.error.params?.field === 'frame';
      if (picture.source.kind === 'frame' && late)
        return refused(
          `the picture "${picture.name}" names frame ${picture.source.frame}, which is not in the video. ` +
            'Give a frame number timeline.captureFrame returned.',
        );
      return resolved;
    }
    const source = picture.source.kind === 'frame' ? `frame:${picture.source.frame}` : picture.source.assetId;
    pictures[picture.name] = {
      bundlePath: `${PICTURES_DIR}/${picture.name}.jpg`,
      source: file,
      key: `cover:${target.timelineId}:${target.revision}:${source}:${index}`,
    };
  }

  const frames = Math.max(1, Math.round(doc.durationSeconds * 30));
  const frame = Math.min(frames - 1, Math.max(0, Math.round(composition.at * 30)));
  const warnings: string[] = [];
  const [placement] = placementsOf(
    [
      {
        itemId: ITEM,
        span: { start: 0, end: frames },
        composition: { entry: composition.entry, files: composition.files },
        values: composition.params,
      },
    ],
    reader,
    (note) => warnings.push(note),
  );
  if (!placement) return refused(warnings[0] ?? 'the composition could not be read');

  // The composition draws the whole cover; under it is black, never a look of Taalcut's.
  const under = join(work, 'under.png');
  await writeFile(under, neutralPng([0, 0, 0]));
  const scene = sceneTimeline([{ frame: 0, picture: { file: under, ext: 'png' } }], frames, {
    width,
    height,
  });
  const preset = canvasPreset(presetFor(DEFAULT_PRESET_ID), { width, height });
  const compiled = compileComposition(scene.timeline, {
    variant: 'export',
    preset,
    burnCaptions: false,
    fonts: createCompositionFonts(deps.fontsDir, await deps.measurer()),
    media: (visual) => {
      const picture = scene.pictures.get(visual.id);
      return picture
        ? {
            file: picture.file,
            key: `cover-under:${visual.id}`,
            mediaStart: RationalTime.zero(FRAMES_RATE),
            ext: picture.ext,
          }
        : undefined;
    },
    compositions: [{ ...placement, pictures }],
  });
  if (!compiled.ok) return compiled;
  const dir = join(work, 'bundle');
  await writeBundle(compiled.value, dir);
  const session = await openStillSession(deps, dir, scene.timeline, preset);
  if (!session.ok) return session;
  try {
    const shot = await session.value.screenshot(frame);
    if (!shot.ok) return shot;
    const probed = await session.value.evaluateAt(frame, CONTENT_PROBE);
    if (!probed.ok) return probed;
    const facts = await session.value.evaluateAt(frame, coverFactsProbe(width, height));
    if (!facts.ok) return facts;
    const content = (probed.value as ProbedContent[]).find((item) => item.id === ITEM) ?? null;
    const checks = coverChecks({
      aspect: cover.aspect,
      width,
      height,
      medium: cover.medium,
      content,
      facts: facts.value as CoverFacts,
      fonts: gated.prepared.fonts,
    });
    return ok({ jpeg: shot.value, width, height, checks });
  } finally {
    await session.value.close();
  }
}
