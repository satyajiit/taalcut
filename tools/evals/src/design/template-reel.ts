// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A template case's made-up reel (HFW1 tpl): each overlay's fixture composition put in a reel workspace and drawn
 * with render's headless draw (`workspaceFrames` over a picture) at any second of the reel, over the footage still
 * and over the overlays already on, so a frame shows every graphic on at that time. What each draw measures at its
 * overlay's middle (where its content sits, how many lines its words are on) is the reel's known box; the reading's
 * overlays are built from it, as BRK1's measurement would build them, and the template's briefs from those
 * (render's `compositionBriefs`). The reel's frames at a brief's moments (render's `reelMomentsOf`) are what the
 * app cuts from the kept reel. A reel of another shape (`reelHeight`) is drawn in the canvas's top band and cut to it
 * (`crop`), and what its draws measure is read as shares of that band.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  newId,
  RationalTime,
  templateSchema,
  type Box,
  type ProjectId,
  type Template,
  type TextOverlay,
  type WorkspaceFrame,
} from '@taalcut/core';
import { reelMomentsOf, type CompositionBrief, type DesignPicture, type ReelFrame } from '@taalcut/render';
import { fixtureTemplate } from '../casting/template';
import type { ReelOverlay, TemplateCase } from './template-cases';
import type { FramesFn } from './world';
import { FIXTURES } from './world';

export const REEL_FIXTURES = join(FIXTURES, 'reel');
const FPS = 30;
/** The reel fixtures' own length, seconds (their `data-duration`). */
const FIXTURE_SECONDS = 3;
/** Curated sans cap height share, for the reading's cap height from the fixture's type size. */
const CAP_SHARE = 0.71;
const CANVAS_HEIGHT = 1920;

export interface Measured {
  readonly box: Box | null;
  readonly lines: number | null;
}

export interface Reel {
  readonly template: Template;
  /** Each template overlay's case overlay. */
  readonly overlays: ReadonlyMap<TextOverlay['id'], ReelOverlay>;
  /** What the reel's draw measured for each overlay at its middle. */
  readonly measured: ReadonlyMap<TextOverlay['id'], Measured>;
  /** The reel's frames for a brief, as the app's reelFrames gives them. */
  frames(brief: CompositionBrief): Promise<ReelFrame[]>;
  /** The reel's picture at a second (every overlay on then, over the footage). */
  pictureAt(seconds: number): Promise<DesignPicture>;
}

interface Placed {
  readonly overlay: ReelOverlay;
  readonly files: { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  readonly entry: string;
}

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const on = (overlay: ReelOverlay, seconds: number) =>
  seconds >= overlay.startFrame / FPS && seconds < (overlay.startFrame + overlay.frames) / FPS;
const local = (overlay: ReelOverlay, seconds: number) =>
  Math.round(Math.min(FIXTURE_SECONDS - 1 / FPS, Math.max(0, seconds - overlay.startFrame / FPS)) * 1000) /
  1000;

export interface ReelDeps {
  readonly frames: FramesFn;
  readonly store: { putBlob(projectId: ProjectId, data: Uint8Array): Promise<unknown> };
  /** The footage still every reel frame is drawn over (for a reel of another shape, in the canvas's top band). */
  readonly footage: DesignPicture;
  /** A drawn canvas cut to the reel's top `height` px (a reel of another shape); none for a 9:16 reel. */
  readonly crop?: (picture: DesignPicture, height: number) => Promise<DesignPicture>;
}

/** Puts a case's fixtures in a reel workspace of their own. */
async function placeFixtures(entry: TemplateCase, projectId: ProjectId, deps: ReelDeps): Promise<Placed[]> {
  const placed: Placed[] = [];
  for (const overlay of entry.overlays) {
    const data = new Uint8Array(await readFile(join(REEL_FIXTURES, `${overlay.fixture}.html`)));
    await deps.store.putBlob(projectId, data);
    const entryPath = `${overlay.fixture}/index.html`;
    placed.push({
      overlay,
      entry: entryPath,
      files: [{ path: entryPath, sha256: sha(data), bytes: data.byteLength }],
    });
  }
  return placed;
}

/** One draw of a reel overlay over a picture; its still and what it measured. */
async function drawOne(
  deps: ReelDeps,
  projectId: ProjectId,
  placed: Placed,
  seconds: number,
  over: DesignPicture,
  maxDimension: number,
): Promise<{ picture: DesignPicture; frame: WorkspaceFrame }> {
  const drawn = await deps.frames(
    {
      projectId,
      entry: placed.entry,
      files: placed.files,
      params: { text: placed.overlay.words },
      seconds: [local(placed.overlay, seconds)],
      over: { kind: 'image', mimeType: over.mimeType, dataBase64: over.data },
      maxDimension,
    },
    { signal: new AbortController().signal },
  );
  const frame = drawn.ok ? drawn.value.frames[0] : undefined;
  if (!frame)
    throw new Error(
      `The reel's ${placed.overlay.fixture} did not draw: ${drawn.ok ? 'no still' : drawn.error.code}`,
    );
  return { picture: { data: frame.dataBase64, mimeType: frame.mimeType }, frame };
}

/** The reading's overlay for a case overlay, from what its draw measured (shares of the reel's frame). */
function overlayOf(
  overlay: ReelOverlay,
  measured: Measured,
  slotId: Template['slots'][number]['id'],
  reelHeight: number,
): TextOverlay {
  const at = (frames: number) => RationalTime.of(frames, { num: FPS, den: 1 });
  const shape = measured.box ?? overlay.standIn.box;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const box = {
    x: clamp(shape.x),
    y: clamp(shape.y),
    width: Math.min(1 - clamp(shape.x), shape.width),
    height: Math.min(1 - clamp(shape.y), shape.height),
  };
  return {
    id: newId<'TextOverlay'>(),
    text: overlay.words,
    role: overlay.design.kind === 'cta' ? 'cta' : 'label',
    start: at(overlay.startFrame),
    duration: at(overlay.frames),
    slotId,
    box,
    appearance: {
      size: (overlay.fontPx * CAP_SHARE) / reelHeight,
      align: 'center',
      case: 'mixed',
      background: 'box',
    },
    styleKey: 'title',
    reveal: 'none',
    design: { ...overlay.design, shape: box, confidence: 0.92 },
    language: 'en',
    confidence: 0.95,
  };
}

/** Draws a case's reel and reads it as a template. */
export async function makeReel(entry: TemplateCase, deps: ReelDeps): Promise<Reel> {
  const projectId = newId<'Project'>() as ProjectId;
  const placed = await placeFixtures(entry, projectId, deps);
  const reelHeight = entry.reelHeight ?? CANVAS_HEIGHT;
  const band = reelHeight / CANVAS_HEIGHT;
  // A band of the canvas is cut from a full-size still; a 9:16 reel draws as eval:design always did.
  const maxDimension = entry.reelHeight ? CANVAS_HEIGHT : 768;
  const inBand = (box: Box | null): Box | null =>
    box && entry.reelHeight ? { ...box, y: box.y / band, height: box.height / band } : box;
  const pictures = new Map<number, DesignPicture>();
  const drawnAt = new Map<string, WorkspaceFrame>();
  const key = (seconds: number) => Math.round(seconds * 1000);
  async function pictureAt(seconds: number): Promise<DesignPicture> {
    const known = pictures.get(key(seconds));
    if (known) return known;
    let picture = deps.footage;
    for (const one of placed)
      if (on(one.overlay, seconds)) {
        const drawn = await drawOne(deps, projectId, one, seconds, picture, maxDimension);
        picture = drawn.picture;
        drawnAt.set(`${one.overlay.fixture}@${key(seconds)}`, drawn.frame);
      }
    const cut = entry.reelHeight && deps.crop ? await deps.crop(picture, entry.reelHeight) : picture;
    pictures.set(key(seconds), cut);
    return cut;
  }
  // Each overlay measured at its middle, as the brief's hold moment shows it.
  const middle = (overlay: ReelOverlay) =>
    Math.round(((overlay.startFrame + overlay.frames / 2) / FPS) * 1000) / 1000;
  const shell = fixtureTemplate([
    { frames: entry.frames, intent: 'Made-up footage', motion: null, energy: 0.5 },
  ]);
  const slotId = shell.slots[0]!.id;
  const canvas = { ...shell.canvas, width: 1080, height: reelHeight };
  const overlays = new Map<TextOverlay['id'], ReelOverlay>();
  const measured = new Map<TextOverlay['id'], Measured>();
  const text: TextOverlay[] = [];
  for (const overlay of entry.overlays) {
    const at = middle(overlay);
    await pictureAt(at);
    const frame = drawnAt.get(`${overlay.fixture}@${key(at)}`);
    const found: Measured = { box: inBand(frame?.box ?? null), lines: frame?.lines ?? null };
    const made = overlayOf(overlay, found, slotId, reelHeight);
    overlays.set(made.id, overlay);
    measured.set(made.id, found);
    text.push(made);
  }
  const template = templateSchema.parse({ ...shell, canvas, text });
  return {
    template,
    overlays,
    measured,
    pictureAt,
    async frames(brief) {
      const frames: ReelFrame[] = [];
      for (const moment of reelMomentsOf(brief))
        frames.push({ ...moment, picture: await pictureAt(moment.seconds) });
      return frames;
    },
  };
}
